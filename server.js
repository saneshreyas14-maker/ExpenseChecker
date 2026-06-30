const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aurabudget-super-secret-key-123456';

// Global to hold migrated balance if upgraded from old schema
let oldStartingBalance = '0.00';

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
        const parsedUrl = new URL(connectionString);
        dbName = parsedUrl.pathname.replace('/', '') || 'aurabudget';
    } catch (e) {
        // fallback
    }
}

let pool;

// PBKDF2 Password Hashing Helpers
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword || !storedPassword.includes(':')) return false;
    const [salt, hash] = storedPassword.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

// Database schema check and migration routine (updates old schema to support users)
async function runMigrationsIfNeeded(conn) {
    console.log('Running database schema check and migrations...');
    
    // 1. Ensure users table exists
    await conn.query(`
        CREATE TABLE IF NOT EXISTS \`users\` (
            \`id\` VARCHAR(50) PRIMARY KEY,
            \`username\` VARCHAR(100) NOT NULL UNIQUE,
            \`password\` VARCHAR(255) NOT NULL,
            \`role\` VARCHAR(20) NOT NULL DEFAULT 'user',
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 2. Check and migrate categories table
    const [catCols] = await conn.query("SHOW COLUMNS FROM categories LIKE 'user_id'");
    if (catCols.length === 0) {
        console.log("Migrating 'categories' table: adding user_id column...");
        try {
            await conn.query("ALTER TABLE categories DROP INDEX name");
        } catch (e) {}
        try {
            await conn.query("ALTER TABLE categories DROP INDEX name_2");
        } catch (e) {}
        
        await conn.query("ALTER TABLE categories ADD COLUMN user_id VARCHAR(50)");
        await conn.query("ALTER TABLE categories ADD CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
        await conn.query("ALTER TABLE categories ADD UNIQUE KEY user_category_name (user_id, name)");
    }

    // 3. Check and migrate transactions table
    const [transCols] = await conn.query("SHOW COLUMNS FROM transactions LIKE 'user_id'");
    if (transCols.length === 0) {
        console.log("Migrating 'transactions' table: adding user_id column...");
        await conn.query("ALTER TABLE transactions ADD COLUMN user_id VARCHAR(50)");
        await conn.query("ALTER TABLE transactions ADD CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
    }

    // 4. Check and migrate personal_notes table
    const [notesCols] = await conn.query("SHOW COLUMNS FROM personal_notes LIKE 'user_id'");
    if (notesCols.length === 0) {
        console.log("Migrating 'personal_notes' table: adding user_id column...");
        await conn.query("ALTER TABLE personal_notes ADD COLUMN user_id VARCHAR(50)");
        await conn.query("ALTER TABLE personal_notes ADD CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
    }

    // 5. Check and migrate checklist_tasks table
    const [tasksCols] = await conn.query("SHOW COLUMNS FROM checklist_tasks LIKE 'user_id'");
    if (tasksCols.length === 0) {
        console.log("Migrating 'checklist_tasks' table: adding user_id column...");
        await conn.query("ALTER TABLE checklist_tasks ADD COLUMN user_id VARCHAR(50)");
        await conn.query("ALTER TABLE checklist_tasks ADD CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
    }

    // 6. Check and migrate settings table (move PK from key to user_id + key)
    const [settingsCols] = await conn.query("SHOW COLUMNS FROM settings LIKE 'user_id'");
    if (settingsCols.length === 0) {
        console.log("Migrating 'settings' table: introducing user_id for multi-tenancy...");
        const [oldSettings] = await conn.query("SELECT * FROM settings");
        try {
            await conn.query("DROP TABLE settings");
        } catch (e) {}
        
        await conn.query(`
            CREATE TABLE \`settings\` (
                \`user_id\` VARCHAR(50) NOT NULL,
                \`setting_key\` VARCHAR(50) NOT NULL,
                \`setting_value\` VARCHAR(255) NOT NULL,
                PRIMARY KEY (\`user_id\`, \`setting_key\`),
                FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        const balanceRow = oldSettings.find(s => s.setting_key === 'starting_balance');
        oldStartingBalance = balanceRow ? balanceRow.setting_value : '0.00';
        console.log("Preserved legacy starting balance:", oldStartingBalance);
    }
}

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
        
        // Safe check / initialization
        const requiredTables = ['users', 'settings', 'categories', 'transactions', 'personal_notes', 'checklist_tasks'];
        let someTableMissing = false;
        for (const table of requiredTables) {
            const [rows] = await conn.query(`SHOW TABLES LIKE '${table}'`);
            if (rows.length === 0) {
                someTableMissing = true;
                console.log(`Database table "${table}" is missing.`);
                break;
            }
        }

        if (someTableMissing) {
            console.log('One or more required database tables are missing. Running schema.sql safe initialization...');
            const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
            const cleanedSql = schemaSql
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/--.*$/gm, '');
            
            const statements = cleanedSql
                .replace(/\r?\n/g, ' ')
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            
            for (const stmt of statements) {
                const lowerStmt = stmt.toLowerCase();
                if (connectionString && (lowerStmt.startsWith('create database') || lowerStmt.startsWith('use '))) {
                    continue;
                }
                await conn.query(stmt);
            }
            console.log('Missing database tables successfully created and initialized!');
        }

        // Run incremental migration check
        await runMigrationsIfNeeded(conn);
        
        conn.release();
    } catch (err) {
        console.error('MySQL database connection failed!');
        console.error('Error Details:', err.message);
    }
}

// Seed default categories for a newly registered user
async function seedDefaultCategories(conn, userId) {
    const defaults = [
        { name: 'Food & Dining', budget: 5000, color: '#f59e0b', icon: 'utensils' },
        { name: 'Housing', budget: 15000, color: '#3b82f6', icon: 'home' },
        { name: 'Transportation', budget: 3000, color: '#06b6d4', icon: 'car' },
        { name: 'Entertainment', budget: 2000, color: '#ec4899', icon: 'tv' },
        { name: 'Utilities', budget: 4000, color: '#a855f7', icon: 'wrench' },
        { name: 'Salary', budget: 0, color: '#10b981', icon: 'briefcase' },
        { name: 'Other', budget: 0, color: '#6366f1', icon: 'help-circle' }
    ];
    
    for (const cat of defaults) {
        const catId = 'cat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
        await conn.query(
            'INSERT INTO categories (id, user_id, name, budget, color, icon) VALUES (?, ?, ?, ?, ?, ?)',
            [catId, userId, cat.name, cat.budget, cat.color, cat.icon]
        );
    }
}

// ==========================================================================
// Authentication Middleware
// ==========================================================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Admin privilege required' });
    }
}

// ==========================================================================
// Authentication REST Routes
// ==========================================================================

// Register Route
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || password.length < 4) {
        return res.status(400).json({ error: 'Username (min 3 chars) and password (min 4 chars) are too short' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if username is taken
        const [existing] = await conn.query('SELECT id FROM users WHERE username = ?', [trimmedUsername]);
        if (existing.length > 0) {
            conn.release();
            return res.status(400).json({ error: 'Username is already taken' });
        }

        // Determine if first user (first user gets Admin role)
        const [userCount] = await conn.query('SELECT COUNT(*) as count FROM users');
        const isFirst = userCount[0].count === 0;
        const role = isFirst ? 'admin' : 'user';

        const userId = 'u-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
        const passHash = hashPassword(password);

        await conn.query(
            'INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)',
            [userId, trimmedUsername, passHash, role]
        );

        if (isFirst) {
            // Assign any orphaned local rows to this newly created admin user
            await conn.query('UPDATE categories SET user_id = ? WHERE user_id IS NULL', [userId]);
            await conn.query('UPDATE transactions SET user_id = ? WHERE user_id IS NULL', [userId]);
            await conn.query('UPDATE personal_notes SET user_id = ? WHERE user_id IS NULL', [userId]);
            await conn.query('UPDATE checklist_tasks SET user_id = ? WHERE user_id IS NULL', [userId]);

            // Save migrated starting balance in settings table
            await conn.query(
                'INSERT INTO settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)',
                [userId, 'starting_balance', String(oldStartingBalance || '0.00')]
            );
        } else {
            // Seed defaults for normal users
            await seedDefaultCategories(conn, userId);
            await conn.query(
                'INSERT INTO settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)',
                [userId, 'starting_balance', '0.00']
            );
        }

        await conn.commit();
        res.status(201).json({ success: true, message: 'User registered successfully', role });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = rows[0];
        const valid = verifyPassword(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Generate JWT Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================================
// Protected Tenant-Isolated Routes
// ==========================================================================

// Server and DB Status endpoint (Public)
app.get('/api/status', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1');
        res.json({ status: 'connected', db: dbName });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Settings API
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE user_id = ?', [req.user.id]);
        const settings = {};
        
        // Default starting balance
        settings['starting_balance'] = '0.00';
        
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', authenticateToken, async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (user_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.user.id, key, String(value), String(value)]
        );
        res.json({ success: true, key, value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Categories CRUD APIs
app.get('/api/categories', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE user_id = ?', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', authenticateToken, async (req, res) => {
    const { id, name, budget, color, icon } = req.body;
    const catId = id || 'cat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    try {
        // Enforce uniqueness check on category names for this user specifically
        const [dup] = await pool.query(
            'SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?',
            [req.user.id, name.trim(), catId]
        );
        if (dup.length > 0) {
            return res.status(400).json({ error: 'A category with this name already exists.' });
        }

        await pool.query(
            `INSERT INTO categories (id, user_id, name, budget, color, icon) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE name = ?, budget = ?, color = ?, icon = ?`,
            [catId, req.user.id, name.trim(), budget, color, icon, name.trim(), budget, color, icon]
        );
        res.json({ success: true, category: { id: catId, name: name.trim(), budget, color, icon } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk edit all categories and starting balance transactional endpoint
app.post('/api/categories/bulk', authenticateToken, async (req, res) => {
    const { categories, startingBalance } = req.body;
    const conn = await pool.getConnection();
    
    try {
        await conn.beginTransaction();

        // 1. Update starting balance in settings table
        await conn.query(
            'INSERT INTO settings (user_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.user.id, 'starting_balance', String(startingBalance || 0), String(startingBalance || 0)]
        );

        // 2. Fetch existing category IDs in DB for this user
        const [existing] = await conn.query('SELECT id FROM categories WHERE user_id = ?', [req.user.id]);
        const dbIds = existing.map(row => row.id);

        // 3. Find IDs to delete
        const requestIds = categories.map(c => c.id).filter(id => id);
        const toDeleteIds = dbIds.filter(id => !requestIds.includes(id));

        if (toDeleteIds.length > 0) {
            await conn.query('DELETE FROM categories WHERE id IN (?) AND user_id = ?', [toDeleteIds, req.user.id]);
        }

        // 4. Save categories
        for (const cat of categories) {
            const catId = cat.id || 'cat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
            const budget = parseFloat(cat.budget) || 0;
            
            await conn.query(
                `INSERT INTO categories (id, user_id, name, budget, color, icon) 
                 VALUES (?, ?, ?, ?, ?, ?) 
                 ON DUPLICATE KEY UPDATE name = ?, budget = ?, color = ?, icon = ?`,
                [catId, req.user.id, cat.name.trim(), budget, cat.color, cat.icon, cat.name.trim(), budget, cat.color, cat.icon]
            );
        }

        await conn.commit();
        res.json({ success: true, message: 'Bulk update complete' });
    } catch (err) {
        await conn.rollback();
        console.error('Bulk update error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

app.delete('/api/categories/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, req.user.id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transactions CRUD APIs
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM transactions WHERE user_id = ?', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
    const { id, description, amount, type, categoryId, date } = req.body;
    const transId = id || 't-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    try {
        await pool.query(
            `INSERT INTO transactions (id, user_id, description, amount, type, category_id, date) 
             VALUES (?, ?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE description = ?, amount = ?, type = ?, category_id = ?, date = ?`,
            [transId, req.user.id, description, amount, type, categoryId, date, description, amount, type, categoryId, date]
        );
        res.json({ success: true, transaction: { id: transId, description, amount, type, categoryId, date } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, req.user.id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Personal Notes CRUD APIs
app.get('/api/notes', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM personal_notes WHERE user_id = ? ORDER BY created_at ASC', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', authenticateToken, async (req, res) => {
    const { message } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO personal_notes (user_id, message) VALUES (?, ?)', [req.user.id, message]);
        res.json({ success: true, note: { id: result.insertId, message, created_at: new Date() } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM personal_notes WHERE id = ? AND user_id = ?', [id, req.user.id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checklist CRUD APIs
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM checklist_tasks WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
    const { task_text } = req.body;
    try {
        const [result] = await pool.query('INSERT INTO checklist_tasks (user_id, task_text) VALUES (?, ?)', [req.user.id, task_text]);
        res.json({ success: true, task: { id: result.insertId, task_text, is_completed: false } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { is_completed } = req.body;
    try {
        await pool.query('UPDATE checklist_tasks SET is_completed = ? WHERE id = ? AND user_id = ?', [is_completed ? 1 : 0, id, req.user.id]);
        res.json({ success: true, id, is_completed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM checklist_tasks WHERE id = ? AND user_id = ?', [id, req.user.id]);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================================
// Admin Operations
// ==========================================================================

// Get all users with stats
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT 
                u.id, 
                u.username, 
                u.role, 
                u.created_at,
                (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) as transactions_count,
                (SELECT COUNT(*) FROM personal_notes n WHERE n.user_id = u.id) as notes_count,
                (SELECT COUNT(*) FROM checklist_tasks tk WHERE tk.user_id = u.id) as tasks_count
            FROM users u
            ORDER BY u.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin create user
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password and role are required' });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || password.length < 4) {
        return res.status(400).json({ error: 'Username (min 3 chars) and password (min 4 chars) are too short' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if username taken
        const [existing] = await conn.query('SELECT id FROM users WHERE username = ?', [trimmedUsername]);
        if (existing.length > 0) {
            conn.release();
            return res.status(400).json({ error: 'Username is already taken' });
        }

        const userId = 'u-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
        const passHash = hashPassword(password);

        await conn.query(
            'INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)',
            [userId, trimmedUsername, passHash, role]
        );

        // Seed default categories
        await seedDefaultCategories(conn, userId);
        await conn.query(
            'INSERT INTO settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)',
            [userId, 'starting_balance', '0.00']
        );

        await conn.commit();
        res.status(201).json({ success: true, message: 'User created successfully', user: { id: userId, username: trimmedUsername, role } });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Admin edit user role or password
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { role, password } = req.body;

    if (!role && !password) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    // Protect against self-demotion/de-admining
    if (id === req.user.id && role && role !== 'admin') {
        return res.status(400).json({ error: 'You cannot remove your own admin privileges.' });
    }

    try {
        if (role && password) {
            const passHash = hashPassword(password);
            await pool.query('UPDATE users SET role = ?, password = ? WHERE id = ?', [role, passHash, id]);
        } else if (role) {
            await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        } else if (password) {
            const passHash = hashPassword(password);
            await pool.query('UPDATE users SET password = ? WHERE id = ?', [passHash, id]);
        }
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin delete user
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (id === req.user.id) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    try {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin aggregated statistics
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [usersCountRows] = await pool.query('SELECT COUNT(*) as count FROM users');
        const [transactionsCountRows] = await pool.query('SELECT COUNT(*) as count, SUM(amount) as total_volume FROM transactions');
        
        res.json({
            totalUsers: usersCountRows[0].count,
            totalTransactions: transactionsCountRows[0].count,
            totalVolume: transactionsCountRows[0].total_volume || 0,
            dbName,
            status: 'online'
        });
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
