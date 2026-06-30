const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname));

// MySQL connection pool configuration
const connectionString = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.JAWSDB_URL || process.env.CLEARDB_DATABASE_URL;
let dbName = process.env.DB_NAME || 'aurabudget';

if (connectionString) {
    try {
        // Extract database name from connection URL
        const parsedUrl = new URL(connectionString);
        dbName = parsedUrl.pathname.replace('/', '') || 'aurabudget';
    } catch (e) {
        // fallback
    }
}

let pool;

async function connectDatabase() {
    try {
        if (connectionString) {
            pool = mysql.createPool(connectionString);
            console.log('Connecting to MySQL Database using environment URL string...');
        } else {
            const dbConfig = {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'aurabudget'
            };
            pool = mysql.createPool(dbConfig);
            console.log(`Connecting to MySQL Database: "${dbConfig.database}" at ${dbConfig.host}:${dbConfig.port}...`);
        }
        
        // Test connection
        const conn = await pool.getConnection();
        console.log(`Successfully connected to MySQL database: "${dbName}"`);
        conn.release();
    } catch (err) {
        console.error('MySQL database connection failed!');
        console.error('Error Details:', err.message);
        console.log('Please ensure that:');
        console.log('1. MySQL server is running.');
        console.log('2. The database is initialized by running: mysql -u root < schema.sql');
        console.log('3. The credentials in .env or cloud connection URL are correct.');
    }
}

// ==========================================================================
// API REST Routes
// ==========================================================================

// Server and DB Status endpoint
app.get('/api/status', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1');
        res.json({ status: 'connected', db: dbName });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Settings API
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, String(value), String(value)]
        );
        res.json({ success: true, key, value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Categories CRUD APIs
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', async (req, res) => {
    const { id, name, budget, color, icon } = req.body;
    const catId = id || 'cat-' + Date.now();
    try {
        await pool.query(
            `INSERT INTO categories (id, name, budget, color, icon) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE name = ?, budget = ?, color = ?, icon = ?`,
            [catId, name, budget, color, icon, name, budget, color, icon]
        );
        res.json({ success: true, category: { id: catId, name, budget, color, icon } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk edit all categories and starting balance transactional endpoint
app.post('/api/categories/bulk', async (req, res) => {
    const { categories, startingBalance } = req.body;
    const conn = await pool.getConnection();
    
    try {
        await conn.beginTransaction();

        // 1. Update starting balance in settings table
        await conn.query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['starting_balance', String(startingBalance || 0), String(startingBalance || 0)]
        );

        // 2. Fetch existing category IDs in db
        const [existing] = await conn.query('SELECT id FROM categories');
        const dbIds = existing.map(row => row.id);

        // 3. Find IDs to delete (those in DB but NOT in requested bulk list)
        const requestIds = categories.map(c => c.id).filter(id => id);
        const toDeleteIds = dbIds.filter(id => !requestIds.includes(id));

        if (toDeleteIds.length > 0) {
            // Delete removed categories (referenced transactions will have category_id set to null)
            await conn.query('DELETE FROM categories WHERE id IN (?)', [toDeleteIds]);
        }

        // 4. Save (Insert / Update) categories
        for (const cat of categories) {
            const catId = cat.id || 'cat-' + Date.now() + Math.random().toString(36).substr(2, 4);
            const budget = parseFloat(cat.budget) || 0;
            
            await conn.query(
                `INSERT INTO categories (id, name, budget, color, icon) 
                 VALUES (?, ?, ?, ?, ?) 
                 ON DUPLICATE KEY UPDATE name = ?, budget = ?, color = ?, icon = ?`,
                [catId, cat.name, budget, cat.color, cat.icon, cat.name, budget, cat.color, cat.icon]
            );
        }

        await conn.commit();
        res.json({ success: true, message: 'Bulk update complete' });
    } catch (err) {
        await conn.rollback();
        console.error('Bulk update error: rollback executed.', err);
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM categories WHERE id = ?', [id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transactions CRUD APIs
app.get('/api/transactions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM transactions');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    const { id, description, amount, type, categoryId, date } = req.body;
    const transId = id || 't-' + Date.now();
    try {
        await pool.query(
            `INSERT INTO transactions (id, description, amount, type, category_id, date) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE description = ?, amount = ?, type = ?, category_id = ?, date = ?`,
            [transId, description, amount, type, categoryId, date, description, amount, type, categoryId, date]
        );
        res.json({ success: true, transaction: { id: transId, description, amount, type, categoryId, date } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/transactions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM transactions WHERE id = ?', [id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Personal Notes CRUD APIs
app.get('/api/notes', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM personal_notes ORDER BY created_at ASC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    const { message } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO personal_notes (message) VALUES (?)', [message]);
        res.json({ success: true, note: { id: result.insertId, message, created_at: new Date() } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM personal_notes WHERE id = ?', [id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checklist CRUD APIs
app.get('/api/tasks', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM checklist_tasks ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    const { task_text } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO checklist_tasks (task_text) VALUES (?)', [task_text]);
        res.json({ success: true, task: { id: result.insertId, task_text, is_completed: false } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { is_completed } = req.body;
    try {
        await pool.query('UPDATE checklist_tasks SET is_completed = ? WHERE id = ?', [is_completed ? 1 : 0, id]);
        res.json({ success: true, id, is_completed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM checklist_tasks WHERE id = ?', [id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Default route fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running at: http://localhost:${PORT}`);
    connectDatabase();
});
