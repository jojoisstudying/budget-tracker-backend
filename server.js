const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jojo:JOSHUAAJA@budget-tracker-cluster.uqrazoi.mongodb.net/?appName=budget-tracker-cluster';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch(err => console.error('MongoDB connection error:', err));

// USER MODEL
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// BUDGET PROJECT MODEL
const budgetProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const BudgetProject = mongoose.model('BudgetProject', budgetProjectSchema);

// TRANSACTION MODEL (updated with budgetProjectId)
const transactionSchema = new mongoose.Schema({
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    budgetProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'BudgetProject', required: true },
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// MIDDLEWARE: Verify JWT Token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// AUTH ROUTES

// Signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            email,
            password: hashedPassword
        });

        await user.save();

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({ token, userId: user._id, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({ token, userId: user._id, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
});

// BUDGET PROJECT ROUTES

// Get all budget projects for logged-in user
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await BudgetProject.find({ userId: req.user.userId }).sort({ updatedAt: -1 });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error });
    }
});

// Create new budget project
app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;

        const project = new BudgetProject({
            title,
            userId: req.user.userId
        });

        await project.save();
        res.status(201).json(project);
    } catch (error) {
        res.status(400).json({ message: 'Error creating project', error });
    }
});

// Delete budget project
app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.id, userId: req.user.userId });
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await Transaction.deleteMany({ budgetProjectId: req.params.id });
        await BudgetProject.findByIdAndDelete(req.params.id);

        res.json({ message: 'Project and associated transactions deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting project', error });
    }
});

// Rename budget project
app.put('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;
        
        const project = await BudgetProject.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { title, updatedAt: Date.now() },
            { new: true }
        );

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json(project);
    } catch (error) {
        res.status(500).json({ message: 'Error updating project', error });
    }
});

// TRANSACTION ROUTES (now protected and linked to budget projects)

// Get all transactions for a specific budget project
app.get('/api/projects/:projectId/transactions', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const transactions = await Transaction.find({ budgetProjectId: req.params.projectId }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching transactions', error });
    }
});

// Create transaction for a specific budget project
app.post('/api/projects/:projectId/transactions', authenticateToken, async (req, res) => {
    try {
        const { description, amount, type } = req.body;

        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const transaction = new Transaction({
            description,
            amount: parseFloat(amount),
            type,
            budgetProjectId: req.params.projectId
        });

        await transaction.save();
        
        project.updatedAt = Date.now();
        await project.save();

        res.status(201).json(transaction);
    } catch (error) {
        res.status(400).json({ message: 'Error creating transaction', error });
    }
});

// Delete transaction
app.delete('/api/projects/:projectId/transactions/:transactionId', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await Transaction.findByIdAndDelete(req.params.transactionId);
        
        project.updatedAt = Date.now();
        await project.save();

        res.json({ message: 'Transaction deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting transaction', error });
    }
});

// AI ROUTE
const https = require('https');

app.post('/api/ai', authenticateToken, async (req, res) => {
    try {
        const { messages } = req.body;
        
        const payload = JSON.stringify({
            model: 'openai/gpt-4o-mini',
            messages: messages,
            temperature: 0.7,
            max_tokens: 800
        });

        const options = {
            hostname: 'models.inference.ai.azure.com',
            path: '/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const apiReq = https.request(options, (apiRes) => {
            let data = '';
            apiRes.on('data', chunk => data += chunk);
            apiRes.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.status(500).json({ message: 'Parse error' });
                }
            });
        });

        apiReq.on('error', (e) => {
            res.status(500).json({ message: 'Request error', error: e.message });
        });

        apiReq.write(payload);
        apiReq.end();

    } catch (error) {
        res.status(500).json({ message: 'AI error', error });
    }
});

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'Budget Tracker Backend with Auth is running!' });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});