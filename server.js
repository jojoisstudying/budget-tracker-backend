const https = require('https');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

app.use(cors({
    origin: ['https://jojoisstudying.github.io', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://jojo:JOSHUAAJA@budget-tracker-cluster.uqrazoi.mongodb.net/?appName=budget-tracker-cluster';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch(err => console.error('MongoDB connection error:', err));

// ── USER MODEL ────────────────────────────────────
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// ── BUDGET PROJECT MODEL ──────────────────────────
const budgetProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const BudgetProject = mongoose.model('BudgetProject', budgetProjectSchema);

// ── CATEGORY MODEL ────────────────────────────────
const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    emoji: { type: String, default: '📦' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDefault: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const Category = mongoose.model('Category', categorySchema);

const DEFAULT_CATEGORIES = [
    { name: 'Food', emoji: '🍔', isDefault: false, order: 0 },
    { name: 'Transport', emoji: '🚗', isDefault: false, order: 1 },
    { name: 'Bills', emoji: '💡', isDefault: false, order: 2 },
    { name: 'Entertainment', emoji: '🎮', isDefault: false, order: 3 },
    { name: 'Health', emoji: '💊', isDefault: false, order: 4 },
    { name: 'Shopping', emoji: '🛍️', isDefault: false, order: 5 },
    { name: 'Other', emoji: '📦', isDefault: true, order: 6 },
];

// ── TRANSACTION MODEL ─────────────────────────────
const transactionSchema = new mongoose.Schema({
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: 'Other' },
    categoryEmoji: { type: String, default: '📦' },
    budgetProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'BudgetProject', required: true },
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// ── MIDDLEWARE: Verify JWT ────────────────────────
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

// ── AUTH ROUTES ───────────────────────────────────

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({ token, userId: user._id, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ message: 'Invalid credentials' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, userId: user._id, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Current password is incorrect' });

        if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error changing password', error });
    }
});

// ── CATEGORY ROUTES ───────────────────────────────

app.get('/api/categories', authenticateToken, async (req, res) => {
    try {
        let categories = await Category.find({ userId: req.user.userId }).sort({ order: 1 });

        if (categories.length === 0) {
            const toInsert = DEFAULT_CATEGORIES.map(c => ({ ...c, userId: req.user.userId }));
            categories = await Category.insertMany(toInsert);
        }

        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error });
    }
});

app.post('/api/categories', authenticateToken, async (req, res) => {
    try {
        const { name, emoji } = req.body;

        if (!name || name.trim() === '') return res.status(400).json({ message: 'Category name is required' });

        const lastCat = await Category.findOne({ userId: req.user.userId }).sort({ order: -1 });
        const newOrder = lastCat ? lastCat.order + 1 : 0;

        const category = new Category({
            name: name.trim(),
            emoji: emoji || '📦',
            userId: req.user.userId,
            isDefault: false,
            order: newOrder
        });

        await category.save();
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ message: 'Error creating category', error });
    }
});

app.delete('/api/categories/:id', authenticateToken, async (req, res) => {
    try {
        const category = await Category.findOne({ _id: req.params.id, userId: req.user.userId });

        if (!category) return res.status(404).json({ message: 'Category not found' });
        if (category.isDefault) return res.status(403).json({ message: 'Cannot delete default category' });

        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting category', error });
    }
});

app.put('/api/categories/:id', authenticateToken, async (req, res) => {
    try {
        const { name, emoji } = req.body;

        const category = await Category.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { name, emoji },
            { new: true }
        );

        if (!category) return res.status(404).json({ message: 'Category not found' });
        res.json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
});

// ── BUDGET PROJECT ROUTES ─────────────────────────

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await BudgetProject.find({ userId: req.user.userId }).sort({ updatedAt: -1 });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error });
    }
});

app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;
        const project = new BudgetProject({ title, userId: req.user.userId });
        await project.save();
        res.status(201).json(project);
    } catch (error) {
        res.status(400).json({ message: 'Error creating project', error });
    }
});

app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.id, userId: req.user.userId });
        if (!project) return res.status(404).json({ message: 'Project not found' });

        await Transaction.deleteMany({ budgetProjectId: req.params.id });
        await BudgetProject.findByIdAndDelete(req.params.id);

        res.json({ message: 'Project and associated transactions deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting project', error });
    }
});

app.put('/api/projects/:id', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;
        const project = await BudgetProject.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { title, updatedAt: Date.now() },
            { new: true }
        );
        if (!project) return res.status(404).json({ message: 'Project not found' });
        res.json(project);
    } catch (error) {
        res.status(500).json({ message: 'Error updating project', error });
    }
});

// ── TRANSACTION ROUTES ────────────────────────────

app.get('/api/projects/:projectId/transactions', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        if (!project) return res.status(404).json({ message: 'Project not found' });

        const transactions = await Transaction.find({ budgetProjectId: req.params.projectId }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching transactions', error });
    }
});

app.post('/api/projects/:projectId/transactions', authenticateToken, async (req, res) => {
    try {
        const { description, amount, type, categoryId, categoryName, categoryEmoji } = req.body;

        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        if (!project) return res.status(404).json({ message: 'Project not found' });

        const transaction = new Transaction({
            description,
            amount: parseFloat(amount),
            type,
            categoryId: categoryId || null,
            categoryName: categoryName || 'Other',
            categoryEmoji: categoryEmoji || '📦',
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

app.delete('/api/projects/:projectId/transactions/:transactionId', authenticateToken, async (req, res) => {
    try {
        const project = await BudgetProject.findOne({ _id: req.params.projectId, userId: req.user.userId });
        if (!project) return res.status(404).json({ message: 'Project not found' });

        await Transaction.findByIdAndDelete(req.params.transactionId);

        project.updatedAt = Date.now();
        await project.save();

        res.json({ message: 'Transaction deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting transaction', error });
    }
});

// ── AI ROUTE ──────────────────────────────────────

app.post('/api/ai', authenticateToken, async (req, res) => {
    try {
        const { messages } = req.body;

        const payload = JSON.stringify({
            model: 'gpt-4o-mini',
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

// ── TEST ROUTE ────────────────────────────────────

app.get('/', (req, res) => {
    res.json({ message: 'Budget Tracker Backend with Auth is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Keep Railway alive
setInterval(() => {
    https.get('https://budget-tracker-backend-production-16e4.up.railway.app/', () => {});
}, 14 * 60 * 1000);