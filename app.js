// ==========================================================================
// AuraBudget Application Controller (Full-Stack DB Connected)
// ==========================================================================

// Global App State
let state = {
    categories: [],
    transactions: [],
    notes: [],
    tasks: [],
    startingBalance: 0.00,
    currentView: 'dashboard',
    activeTransactionId: null,
    activeCategoryId: null,
    deleteTarget: null // { type: 'transaction'|'category', id }
};

// Chart.js references
let expenseChart = null;
let budgetChart = null;

// ==========================================================================
// Initialization & Database Sync
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    // Current date representation
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-US', options);

    // Initial database load
    await loadDatabaseData();
    switchView('dashboard');
}

async function loadDatabaseData() {
    try {
        // Fetch Settings (Starting Balance)
        const settingsRes = await fetch('/api/settings');
        if (!settingsRes.ok) throw new Error('Failed to load settings');
        const settings = await settingsRes.json();
        state.startingBalance = parseFloat(settings.starting_balance) || 0.00;

        // Fetch Categories
        const categoriesRes = await fetch('/api/categories');
        if (!categoriesRes.ok) throw new Error('Failed to load categories');
        state.categories = await categoriesRes.json();

        // Fetch Transactions
        const transactionsRes = await fetch('/api/transactions');
        if (!transactionsRes.ok) throw new Error('Failed to load transactions');
        state.transactions = await transactionsRes.json();

        // Fetch Planner Notes
        const notesRes = await fetch('/api/notes');
        if (notesRes.ok) {
            state.notes = await notesRes.json();
        }

        // Fetch Checklist Tasks
        const tasksRes = await fetch('/api/tasks');
        if (tasksRes.ok) {
            state.tasks = await tasksRes.json();
        }

        renderCategoryDropdowns();
    } catch (err) {
        console.error('Error connecting to backend database APIs:', err);
        showToast('Database connection failed. Please ensure MySQL and backend are running.', 'danger');
    }
}

// ==========================================================================
// View Management & Rendering
// ==========================================================================

function switchView(viewName) {
    state.currentView = viewName;
    
    // Update navigation menu visual active state
    document.querySelectorAll('.nav-menu .nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Manage sections display
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.remove('active');
    });

    if (viewName === 'dashboard') {
        document.getElementById('btn-nav-dashboard').classList.add('active');
        document.getElementById('view-dashboard').classList.add('active');
        renderDashboard();
    } else if (viewName === 'transactions') {
        document.getElementById('btn-nav-transactions').classList.add('active');
        document.getElementById('view-transactions').classList.add('active');
        renderTransactionsView();
    } else if (viewName === 'budgets') {
        document.getElementById('btn-nav-budgets').classList.add('active');
        document.getElementById('view-budgets').classList.add('active');
        renderBudgetsView();
    } else if (viewName === 'planner') {
        document.getElementById('btn-nav-planner').classList.add('active');
        document.getElementById('view-planner').classList.add('active');
        renderPlannerView();
    }

    lucide.createIcons();
}

function renderDashboard() {
    // Calculate global stats
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const monthlyTransactions = state.transactions.filter(t => {
        if (!t.date) return false;
        const tDate = new Date(t.date);
        return tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear;
    });

    // Net balance (Starting Balance + all time total income - all time total expenses)
    const totalAllTimeIncome = state.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalAllTimeExpenses = state.transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const netBalance = state.startingBalance + totalAllTimeIncome - totalAllTimeExpenses;

    // Monthly stats
    const monthlyIncome = monthlyTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const monthlyExpenses = monthlyTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // Sum of category budgets (excluding unlimited categories with budget=0)
    const totalBudgetLimit = state.categories.reduce((sum, c) => sum + parseFloat(c.budget || 0), 0);

    // Render stats
    document.getElementById('stat-net-balance').textContent = formatCurrency(netBalance);
    document.getElementById('stat-net-balance').className = 'stat-value ' + (netBalance >= 0 ? '' : 'text-danger');
    document.getElementById('stat-total-income').textContent = formatCurrency(monthlyIncome);
    document.getElementById('stat-total-expenses').textContent = formatCurrency(monthlyExpenses);
    document.getElementById('stat-total-budget').textContent = formatCurrency(totalBudgetLimit);

    // Savings rate
    const savingsRate = monthlyIncome > 0 ? Math.max(0, Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)) : 0;
    document.getElementById('mini-savings-rate').textContent = `${savingsRate}%`;
    document.getElementById('mini-savings-progress').style.width = `${savingsRate}%`;
    document.getElementById('mini-savings-progress').style.backgroundColor = savingsRate > 20 ? 'var(--success)' : (savingsRate > 0 ? 'var(--warning)' : 'var(--danger)');

    // Monthly Expense Percentage of budget
    const budgetPct = totalBudgetLimit > 0 ? Math.round((monthlyExpenses / totalBudgetLimit) * 100) : 0;
    document.getElementById('stat-expenses-limit-label').innerHTML = `<span class="text-primary">${budgetPct}%</span> of total budget limit`;

    // Render Recent Transactions
    renderRecentTransactionsList();

    // Render Category Budgets List
    renderCategoryBudgetsList();

    // Update charts
    renderExpenseDonutChart();

    // Generate alerts
    renderAlertsPanel(monthlyExpenses, totalBudgetLimit);
}

function renderRecentTransactionsList() {
    const listContainer = document.getElementById('dashboard-transactions-rows');
    listContainer.innerHTML = '';

    // Get 5 most recent transactions
    const sorted = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = sorted.slice(0, 5);

    if (recent.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No transactions yet. Click Add Transaction to begin.</td></tr>`;
        return;
    }

    recent.forEach(t => {
        const cat = state.categories.find(c => c.id === t.category_id);
        const catName = cat ? cat.name : 'Uncategorized';
        const catColor = cat ? cat.color : 'var(--text-muted)';
        const catIcon = cat ? cat.icon : 'help-circle';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <span class="transaction-description">${escapeHtml(t.description)}</span>
            </td>
            <td>
                <span class="tag-badge" style="background-color: ${catColor}15; color: ${catColor}; border: 1px solid ${catColor}30;">
                    <i data-lucide="${catIcon}"></i>
                    <span>${catName}</span>
                </span>
            </td>
            <td>${formatDate(t.date)}</td>
            <td class="amount-col ${t.type}">
                ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
            </td>
            <td>
                <div class="category-actions">
                    <button class="btn-icon-sm edit" onclick="openEditTransaction('${t.id}')" title="Edit">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-icon-sm delete" onclick="triggerDelete('transaction', '${t.id}')" title="Delete">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        listContainer.appendChild(row);
    });
}

function renderCategoryBudgetsList() {
    const container = document.getElementById('dashboard-budgets-list');
    container.innerHTML = '';

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // Map each category to its current month's spent amount
    const budgetsData = state.categories.map(cat => {
        const spent = state.transactions
            .filter(t => t.category_id === cat.id && t.type === 'expense' && t.date && new Date(t.date).getMonth() === currentMonth && new Date(t.date).getFullYear() === currentYear)
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        return { ...cat, spent };
    });

    // Sort: categories with budgets and highest spent-to-budget ratios first
    budgetsData.sort((a, b) => {
        const budgetA = parseFloat(a.budget);
        const budgetB = parseFloat(b.budget);
        if (budgetA === 0 && budgetB > 0) return 1;
        if (budgetB === 0 && budgetA > 0) return -1;
        if (budgetA === 0 && budgetB === 0) return 0;
        return (b.spent / budgetB) - (a.spent / budgetA);
    });

    budgetsData.forEach(cat => {
        const budgetLimit = parseFloat(cat.budget);
        const spent = cat.spent;
        const pct = budgetLimit > 0 ? Math.round((spent / budgetLimit) * 100) : 0;
        
        let pctClass = 'normal';
        if (budgetLimit > 0) {
            if (pct >= 100) pctClass = 'critical';
            else if (pct >= 80) pctClass = 'warning';
        }

        const progressPercent = budgetLimit > 0 ? Math.min(100, pct) : (spent > 0 ? 100 : 0);
        const barColor = cat.color;

        const card = document.createElement('div');
        card.className = 'budget-progress-card';
        card.innerHTML = `
            <div class="budget-progress-header">
                <div class="budget-progress-info">
                    <div class="category-icon-badge" style="background-color: ${cat.color}">
                        <i data-lucide="${cat.icon}"></i>
                    </div>
                    <div>
                        <span class="category-title">${escapeHtml(cat.name)}</span>
                    </div>
                </div>
                <div class="budget-amounts">
                    <span class="spent-amt">${formatCurrency(spent)}</span>
                    <span class="limit-amt">/ ${budgetLimit > 0 ? formatCurrency(budgetLimit) : 'Unlimited'}</span>
                </div>
            </div>
            
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${progressPercent}%; background-color: ${barColor};"></div>
            </div>
            
            <div class="budget-footer">
                <span class="budget-status-text">
                    ${budgetLimit > 0 
                        ? (spent > budgetLimit ? `Over limit by ${formatCurrency(spent - budgetLimit)}` : `${formatCurrency(budgetLimit - spent)} remaining`)
                        : 'No limit set'
                    }
                </span>
                ${budgetLimit > 0 ? `<span class="budget-percentage ${pctClass}">${pct}%</span>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function renderAlertsPanel(monthlyExpenses, totalBudgetLimit) {
    const container = document.getElementById('alerts-panel');
    container.innerHTML = '';

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const alerts = [];

    // Global overall budget alerts
    if (totalBudgetLimit > 0) {
        const globalPct = Math.round((monthlyExpenses / totalBudgetLimit) * 100);
        if (globalPct >= 100) {
            alerts.push({
                type: 'danger',
                msg: `Critical: You have exceeded your total monthly budget limit of ${formatCurrency(totalBudgetLimit)}!`,
                time: 'Just now'
            });
        } else if (globalPct >= 80) {
            alerts.push({
                type: 'warning',
                msg: `Alert: You've utilized ${globalPct}% of your total monthly budget.`,
                time: 'Recently'
            });
        }
    }

    // Category specific alerts
    state.categories.forEach(cat => {
        const budgetLimit = parseFloat(cat.budget);
        if (budgetLimit > 0) {
            const spent = state.transactions
                .filter(t => t.category_id === cat.id && t.type === 'expense' && t.date && new Date(t.date).getMonth() === currentMonth && new Date(t.date).getFullYear() === currentYear)
                .reduce((sum, t) => sum + parseFloat(t.amount), 0);
            
            const pct = Math.round((spent / budgetLimit) * 100);
            if (pct >= 100) {
                alerts.push({
                    type: 'danger',
                    msg: `Exceeded budget limit in ${cat.name} by ${formatCurrency(spent - budgetLimit)}!`,
                    time: 'Just now'
                });
            } else if (pct >= 80) {
                alerts.push({
                    type: 'warning',
                    msg: `${cat.name} budget is at ${pct}% capacity (${formatCurrency(budgetLimit - spent)} left).`,
                    time: 'Recently'
                });
            }
        }
    });

    if (alerts.length === 0) {
        container.innerHTML = `
            <div class="alert-item info">
                <div class="alert-icon"><i data-lucide="sparkles"></i></div>
                <div class="alert-content">
                    <span class="alert-msg">All systems normal!</span>
                    <span class="alert-subtitle">All category spending is within planned limits. Good job!</span>
                </div>
            </div>
        `;
        return;
    }

    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.className = `alert-item ${alert.type}`;
        item.innerHTML = `
            <div class="alert-icon">
                <i data-lucide="${alert.type === 'danger' ? 'alert-octagon' : 'alert-triangle'}"></i>
            </div>
            <div class="alert-content">
                <span class="alert-msg">${escapeHtml(alert.msg)}</span>
                <span class="alert-time">${alert.time}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function renderTransactionsView() {
    // Populate filter dropdown in transactions view if not already populated
    const filterCatDropdown = document.getElementById('filter-category');
    const prevVal = filterCatDropdown.value;
    filterCatDropdown.innerHTML = '<option value="all">All Categories</option>';
    state.categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        filterCatDropdown.appendChild(opt);
    });
    filterCatDropdown.value = prevVal || 'all';

    // Get values from filters
    const typeFilter = document.getElementById('filter-type').value;
    const catFilter = document.getElementById('filter-category').value;
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    const sortOrder = document.getElementById('sort-order').value;

    // Filter transaction list
    let filtered = state.transactions.filter(t => {
        const matchesType = typeFilter === 'all' || t.type === typeFilter;
        const matchesCat = catFilter === 'all' || t.category_id === catFilter;
        const matchesSearch = searchQuery === '' || 
            t.description.toLowerCase().includes(searchQuery) ||
            (state.categories.find(c => c.id === t.category_id)?.name || '').toLowerCase().includes(searchQuery) ||
            t.amount.toString().includes(searchQuery);

        return matchesType && matchesCat && matchesSearch;
    });

    // Sort transaction list
    filtered.sort((a, b) => {
        if (sortOrder === 'date-desc') {
            return new Date(b.date) - new Date(a.date);
        } else if (sortOrder === 'date-asc') {
            return new Date(a.date) - new Date(b.date);
        } else if (sortOrder === 'amount-desc') {
            return parseFloat(b.amount) - parseFloat(a.amount);
        } else if (sortOrder === 'amount-asc') {
            return parseFloat(a.amount) - parseFloat(b.amount);
        }
        return 0;
    });

    // Render count
    document.getElementById('transactions-count-label').textContent = `Showing ${filtered.length} of ${state.transactions.length} transactions`;

    // Render Table Rows
    const tbody = document.getElementById('transactions-list-rows');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem;">No matching transactions found.</td></tr>`;
        return;
    }

    filtered.forEach(t => {
        const cat = state.categories.find(c => c.id === t.category_id);
        const catName = cat ? cat.name : 'Uncategorized';
        const catColor = cat ? cat.color : 'var(--text-muted)';
        const catIcon = cat ? cat.icon : 'help-circle';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <span class="transaction-description">${escapeHtml(t.description)}</span>
            </td>
            <td>
                <span class="tag-badge" style="background-color: ${catColor}15; color: ${catColor}; border: 1px solid ${catColor}30;">
                    <i data-lucide="${catIcon}"></i>
                    <span>${catName}</span>
                </span>
            </td>
            <td>${formatDate(t.date)}</td>
            <td>
                <span class="transaction-type-badge ${t.type}">${t.type}</span>
            </td>
            <td class="amount-col ${t.type}">
                ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
            </td>
            <td>
                <div class="category-actions">
                    <button class="btn-icon-sm edit" onclick="openEditTransaction('${t.id}')" title="Edit">
                        <i data-lucide="edit-3"></i>
                    </button>
                    <button class="btn-icon-sm delete" onclick="triggerDelete('transaction', '${t.id}')" title="Delete">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    lucide.createIcons();
}

function renderBudgetsView() {
    const listContainer = document.getElementById('manage-categories-list');
    listContainer.innerHTML = '';

    state.categories.forEach(cat => {
        const budgetLimit = parseFloat(cat.budget);
        const card = document.createElement('div');
        card.className = 'category-config-card';
        card.innerHTML = `
            <div class="category-config-left">
                <div class="category-icon-badge" style="background-color: ${cat.color}">
                    <i data-lucide="${cat.icon}"></i>
                </div>
                <div class="category-meta">
                    <h4>${escapeHtml(cat.name)}</h4>
                    <p>Limit: ${budgetLimit > 0 ? formatCurrency(budgetLimit) : 'Unlimited (Income / Fixed)'}</p>
                </div>
            </div>
            <div class="category-actions">
                <button class="btn-icon-sm edit" onclick="openEditCategory('${cat.id}')" title="Edit Budget">
                    <i data-lucide="edit-3"></i>
                </button>
                <button class="btn-icon-sm delete" onclick="triggerDelete('category', '${cat.id}')" title="Delete Category">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });

    renderBudgetBarChart();
    lucide.createIcons();
}

function renderCategoryDropdowns() {
    const select = document.getElementById('trans-category');
    select.innerHTML = '';
    state.categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
    });
}

// ==========================================================================
// Planner & Checklists View
// ==========================================================================

function renderPlannerView() {
    // 1. Render Personal self notes
    const notesContainer = document.getElementById('chat-messages-list');
    notesContainer.innerHTML = '';

    if (state.notes.length === 0) {
        notesContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 3rem 1rem; font-size: 0.85rem;">No notes yet. Type a reminder below to post in your stream.</div>`;
    } else {
        state.notes.forEach(note => {
            const timeStr = note.created_at ? new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const dateStr = note.created_at ? new Date(note.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
            
            const msgWrapper = document.createElement('div');
            msgWrapper.className = 'chat-bubble-wrapper self';
            msgWrapper.innerHTML = `
                <div class="chat-bubble">
                    ${escapeHtml(note.message)}
                </div>
                <div class="chat-bubble-meta">
                    <span>${dateStr} at ${timeStr}</span>
                    <button class="btn-delete-note" onclick="deleteNote(${note.id})" title="Delete Reminder">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            `;
            notesContainer.appendChild(msgWrapper);
        });
        
        // Scroll to the bottom of notes container
        setTimeout(() => {
            notesContainer.scrollTop = notesContainer.scrollHeight;
        }, 50);
    }

    // 2. Render Checklist tasks
    const checklistContainer = document.getElementById('checklist-items-list');
    checklistContainer.innerHTML = '';

    if (state.tasks.length === 0) {
        checklistContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 3rem 1rem; font-size: 0.85rem;">No tasks created. Add a task below to start your checklist.</div>`;
    } else {
        state.tasks.forEach(task => {
            const completedClass = task.is_completed ? 'completed' : '';
            const row = document.createElement('div');
            row.className = `checklist-item-row ${completedClass}`;
            row.innerHTML = `
                <div class="checklist-item-left" onclick="toggleTask(${task.id}, ${task.is_completed})">
                    <div class="checklist-checkbox">
                        <i data-lucide="check"></i>
                    </div>
                    <span class="checklist-task-text">${escapeHtml(task.task_text)}</span>
                </div>
                <button class="btn-icon-sm delete" onclick="deleteTask(${task.id})" title="Delete Task" style="margin-left: 0.75rem;">
                    <i data-lucide="trash-2"></i>
                </button>
            `;
            checklistContainer.appendChild(row);
        });
    }

    // 3. Compute checklist progress
    const totalTasks = state.tasks.length;
    const completedTasks = state.tasks.filter(t => t.is_completed).length;
    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    document.getElementById('checklist-progress-text').textContent = `${completedTasks} of ${totalTasks} completed`;
    document.getElementById('checklist-progress-bar').style.width = `${progressPercent}%`;

    lucide.createIcons();
}

window.deleteNote = async function(id) {
    try {
        const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete note');
        showToast('Reminder note deleted', 'info');
        await loadDatabaseData();
        renderPlannerView();
    } catch (err) {
        console.error(err);
        showToast('Error deleting reminder note.', 'danger');
    }
};

window.toggleTask = async function(id, isCompleted) {
    try {
        const res = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_completed: !isCompleted })
        });
        if (!res.ok) throw new Error('Failed to update task state');
        await loadDatabaseData();
        renderPlannerView();
    } catch (err) {
        console.error(err);
        showToast('Error updating checklist task.', 'danger');
    }
};

window.deleteTask = async function(id) {
    try {
        const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete checklist task');
        showToast('Checklist task removed.', 'info');
        await loadDatabaseData();
        renderPlannerView();
    } catch (err) {
        console.error(err);
        showToast('Error removing task from checklist.', 'danger');
    }
};

// ==========================================================================
// Charting Implementations (Chart.js)
// ==========================================================================

function renderExpenseDonutChart() {
    const canvas = document.getElementById('expense-donut-chart');
    if (!canvas) return;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const timeframe = document.getElementById('chart-timeframe').value;

    // Filter transactions
    const expenses = state.transactions.filter(t => {
        if (t.type !== 'expense') return false;
        if (timeframe === 'current-month') {
            if (!t.date) return false;
            const d = new Date(t.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        }
        return true;
    });

    // Group expenses by category
    const catData = {};
    expenses.forEach(t => {
        catData[t.category_id] = (catData[t.category_id] || 0) + parseFloat(t.amount);
    });

    // Map to labels, values, colors
    const labels = [];
    const dataValues = [];
    const backgroundColors = [];
    let totalExpensesSum = 0;

    state.categories.forEach(cat => {
        const val = catData[cat.id] || 0;
        if (val > 0) {
            labels.push(cat.name);
            dataValues.push(val);
            backgroundColors.push(cat.color);
            totalExpensesSum += val;
        }
    });

    // Custom Legend render
    const legendContainer = document.getElementById('chart-custom-legend');
    if (legendContainer) {
        legendContainer.innerHTML = '';
        labels.forEach((label, idx) => {
            const val = dataValues[idx];
            const pct = totalExpensesSum > 0 ? Math.round((val / totalExpensesSum) * 100) : 0;
            const color = backgroundColors[idx];

            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-color" style="background-color: ${color}"></div>
                <div class="legend-info">
                    <span class="legend-name">${escapeHtml(label)}</span>
                    <span class="legend-value">${formatCurrency(val)} (${pct}%)</span>
                </div>
            `;
            legendContainer.appendChild(item);
        });
    }

    // Destroy existing chart to prevent hover bugs
    if (expenseChart) {
        expenseChart.destroy();
    }

    if (dataValues.length === 0) {
        // Draw an empty placeholder donut
        expenseChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: ['No Data'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    expenseChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: backgroundColors,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.1)',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 25, 40, 0.9)',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.label}: ${formatCurrency(context.raw)}`;
                        }
                    }
                }
            }
        }
    });
}

function renderBudgetBarChart() {
    const canvas = document.getElementById('budget-bar-chart');
    if (!canvas) return;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    // Prepare double bars datasets: spent vs budget
    const labels = [];
    const spentValues = [];
    const budgetValues = [];
    const colors = [];

    // Filter only categories with a budget > 0
    state.categories.filter(c => parseFloat(c.budget) > 0).forEach(cat => {
        const spent = state.transactions
            .filter(t => t.category_id === cat.id && t.type === 'expense' && t.date && new Date(t.date).getMonth() === currentMonth && new Date(t.date).getFullYear() === currentYear)
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);

        labels.push(cat.name);
        spentValues.push(spent);
        budgetValues.push(parseFloat(cat.budget));
        colors.push(cat.color);
    });

    if (budgetChart) {
        budgetChart.destroy();
    }

    budgetChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual Spent',
                    data: spentValues,
                    backgroundColor: colors,
                    borderRadius: 4,
                    borderWidth: 0,
                    barPercentage: 0.8,
                    categoryPercentage: 0.5
                },
                {
                    label: 'Budget Limit',
                    data: budgetValues,
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    barPercentage: 0.8,
                    categoryPercentage: 0.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        callback: function(value) {
                            return '$' + value;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Plus Jakarta Sans', size: 10 }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        padding: 15,
                        boxWidth: 12,
                        boxHeight: 12
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 25, 40, 0.9)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${formatCurrency(context.raw)}`;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================================================
// Event Listeners & Modals Control
// ==========================================================================

function setupEventListeners() {
    // Nav Navigation menu
    document.getElementById('btn-nav-dashboard').addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-nav-transactions').addEventListener('click', () => switchView('transactions'));
    document.getElementById('btn-nav-budgets').addEventListener('click', () => switchView('budgets'));
    document.getElementById('btn-nav-planner').addEventListener('click', () => switchView('planner'));
    document.getElementById('btn-view-all-transactions').addEventListener('click', () => switchView('transactions'));

    // Transaction Modal Controls
    document.getElementById('btn-open-transaction-modal').addEventListener('click', () => {
        openTransactionModal();
    });
    document.getElementById('btn-close-transaction-modal').addEventListener('click', closeTransactionModal);
    document.getElementById('btn-cancel-transaction-modal').addEventListener('click', closeTransactionModal);

    // Category Modal Controls
    document.getElementById('btn-open-category-modal').addEventListener('click', () => {
        openCategoryModal();
    });
    document.getElementById('btn-open-category-modal-direct').addEventListener('click', () => {
        openCategoryModal();
    });
    document.getElementById('btn-close-category-modal').addEventListener('click', closeCategoryModal);
    document.getElementById('btn-cancel-category-modal').addEventListener('click', closeCategoryModal);

    // Transaction Form Submission
    document.getElementById('transaction-form').addEventListener('submit', handleTransactionFormSubmit);

    // Category Form Submission
    document.getElementById('category-form').addEventListener('submit', handleCategoryFormSubmit);

    // Delete confirmation dialog actions
    document.getElementById('btn-cancel-delete').addEventListener('click', closeDeleteModal);
    document.getElementById('btn-confirm-delete').addEventListener('click', executeDelete);

    // Bulk Modal Controls
    document.getElementById('btn-open-bulk-modal').addEventListener('click', openBulkModal);
    document.getElementById('btn-close-bulk-modal').addEventListener('click', closeBulkModal);
    document.getElementById('btn-cancel-bulk-modal').addEventListener('click', closeBulkModal);
    document.getElementById('btn-bulk-add-row').addEventListener('click', addBulkRow);
    document.getElementById('btn-save-bulk').addEventListener('click', saveBulkChanges);

    // Planner Chat Submition
    document.getElementById('chat-form').addEventListener('submit', handleChatFormSubmit);

    // Checklist Task Submition
    document.getElementById('checklist-form').addEventListener('submit', handleChecklistFormSubmit);

    // Filters and Search action
    document.getElementById('search-input').addEventListener('input', () => {
        if (state.currentView !== 'transactions') {
            switchView('transactions');
        } else {
            renderTransactionsView();
        }
    });
    document.getElementById('filter-type').addEventListener('change', renderTransactionsView);
    document.getElementById('filter-category').addEventListener('change', renderTransactionsView);
    document.getElementById('sort-order').addEventListener('change', renderTransactionsView);
    document.getElementById('chart-timeframe').addEventListener('change', renderExpenseDonutChart);
}

// Transaction Modal Actions
function openTransactionModal(editId = null) {
    const modal = document.getElementById('transaction-modal');
    const title = document.getElementById('transaction-modal-title');
    const form = document.getElementById('transaction-form');

    form.reset();
    renderCategoryDropdowns();
    
    // Set default date to today
    document.getElementById('trans-date').value = new Date().toISOString().split('T')[0];

    if (editId) {
        state.activeTransactionId = editId;
        title.textContent = 'Edit Transaction';
        const t = state.transactions.find(item => item.id === editId);
        if (t) {
            document.getElementById('transaction-id').value = t.id;
            document.getElementById('trans-desc').value = t.description;
            document.getElementById('trans-type').value = t.type;
            document.getElementById('trans-amount').value = t.amount;
            document.getElementById('trans-category').value = t.category_id;
            document.getElementById('trans-date').value = t.date.split('T')[0];
        }
    } else {
        state.activeTransactionId = null;
        title.textContent = 'Add Transaction';
        document.getElementById('transaction-id').value = '';
    }

    modal.classList.add('active');
}

function closeTransactionModal() {
    document.getElementById('transaction-modal').classList.remove('active');
}

async function handleTransactionFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('transaction-id').value;
    const desc = document.getElementById('trans-desc').value.trim();
    const type = document.getElementById('trans-type').value;
    const amount = parseFloat(document.getElementById('trans-amount').value);
    const categoryId = document.getElementById('trans-category').value;
    const date = document.getElementById('trans-date').value;

    if (!desc || isNaN(amount) || amount <= 0 || !categoryId || !date) {
        showToast('Please fill out all fields with valid information.', 'warning');
        return;
    }

    const payload = {
        id: id || null,
        description: desc,
        amount,
        type,
        categoryId,
        date
    };

    try {
        const res = await fetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save transaction');
        
        showToast(id ? 'Transaction updated successfully!' : 'Transaction added successfully!', 'success');
        
        await loadDatabaseData();
        closeTransactionModal();
        
        // Refresh current active view
        if (state.currentView === 'dashboard') {
            renderDashboard();
        } else if (state.currentView === 'transactions') {
            renderTransactionsView();
        }
    } catch (err) {
        console.error(err);
        showToast('Error saving transaction. Check DB connection.', 'danger');
    }
}

window.openEditTransaction = function(id) {
    openTransactionModal(id);
};

// Category Modal Actions
function openCategoryModal(editId = null) {
    const modal = document.getElementById('category-modal');
    const title = document.getElementById('category-modal-title');
    const form = document.getElementById('category-form');

    form.reset();

    // Default color swatch picker setting
    document.querySelector('input[name="cat-color"][value="#6366f1"]').checked = true;

    if (editId) {
        state.activeCategoryId = editId;
        title.textContent = 'Edit Category & Budget';
        const cat = state.categories.find(item => item.id === editId);
        if (cat) {
            document.getElementById('category-id').value = cat.id;
            document.getElementById('cat-name').value = cat.name;
            document.getElementById('cat-budget').value = cat.budget;
            document.getElementById('cat-icon').value = cat.icon;
            
            const colorOption = document.querySelector(`input[name="cat-color"][value="${cat.color}"]`);
            if (colorOption) {
                colorOption.checked = true;
            }
        }
    } else {
        state.activeCategoryId = null;
        title.textContent = 'Add Category & Budget';
        document.getElementById('category-id').value = '';
    }

    modal.classList.add('active');
}

function closeCategoryModal() {
    document.getElementById('category-modal').classList.remove('active');
}

async function handleCategoryFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('category-id').value;
    const name = document.getElementById('cat-name').value.trim();
    const budget = parseFloat(document.getElementById('cat-budget').value) || 0;
    const icon = document.getElementById('cat-icon').value;
    const color = document.querySelector('input[name="cat-color"]:checked').value;

    if (!name) {
        showToast('Please enter a valid category name.', 'warning');
        return;
    }

    // Check duplicate name
    const dup = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== id);
    if (dup) {
        showToast('A category with this name already exists.', 'warning');
        return;
    }

    const payload = {
        id: id || null,
        name,
        budget,
        icon,
        color
    };

    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to save category');

        showToast(id ? 'Category updated!' : 'New category created!', 'success');

        await loadDatabaseData();
        closeCategoryModal();

        if (state.currentView === 'dashboard') {
            renderDashboard();
        } else if (state.currentView === 'budgets') {
            renderBudgetsView();
        }
    } catch (err) {
        console.error(err);
        showToast('Error saving category to database.', 'danger');
    }
}

window.openEditCategory = function(id) {
    openCategoryModal(id);
};

// Delete Handlers
window.triggerDelete = function(type, id) {
    state.deleteTarget = { type, id };
    const modal = document.getElementById('confirm-delete-modal');
    const warningText = document.getElementById('delete-warning-text');

    if (type === 'category') {
        warningText.textContent = 'Warning: Deleting this category will leave associated transactions uncategorized.';
    } else {
        warningText.textContent = '';
    }

    modal.classList.add('active');
};

function closeDeleteModal() {
    document.getElementById('confirm-delete-modal').classList.remove('active');
    state.deleteTarget = null;
}

async function executeDelete() {
    if (!state.deleteTarget) return;

    const { type, id } = state.deleteTarget;

    try {
        let url = '';
        if (type === 'transaction') {
            url = `/api/transactions/${id}`;
        } else if (type === 'category') {
            url = `/api/categories/${id}`;
        }

        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Failed to delete ${type}`);

        showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`, 'info');
        
        await loadDatabaseData();
        closeDeleteModal();

        // Re-render based on active view
        if (state.currentView === 'dashboard') {
            renderDashboard();
        } else if (state.currentView === 'transactions') {
            renderTransactionsView();
        } else if (state.currentView === 'budgets') {
            renderBudgetsView();
        }
    } catch (err) {
        console.error(err);
        showToast(`Failed to delete the ${type}.`, 'danger');
    }
}

// ==========================================================================
// Bulk Editing sheet Logic
// ==========================================================================

function openBulkModal() {
    const modal = document.getElementById('bulk-modal');
    document.getElementById('bulk-starting-balance').value = state.startingBalance;
    
    renderBulkSheetRows();
    modal.classList.add('active');
}

function closeBulkModal() {
    document.getElementById('bulk-modal').classList.remove('active');
}

function renderBulkSheetRows() {
    const tbody = document.getElementById('bulk-categories-rows');
    tbody.innerHTML = '';

    state.categories.forEach(cat => {
        appendBulkRowElement(cat);
    });
    
    lucide.createIcons();
}

function appendBulkRowElement(cat = { id: '', name: '', budget: 0, color: '#6366f1', icon: 'help-circle' }) {
    const tbody = document.getElementById('bulk-categories-rows');
    const tr = document.createElement('tr');
    
    const iconOptions = [
        { val: 'shopping-bag', label: 'Shopping Bag' },
        { val: 'utensils', label: 'Dining (Utensils)' },
        { val: 'home', label: 'Housing (Home)' },
        { val: 'car', label: 'Transportation (Car)' },
        { val: 'tv', label: 'Entertainment (TV)' },
        { val: 'activity', label: 'Health (Activity)' },
        { val: 'wrench', label: 'Utilities (Wrench)' },
        { val: 'graduation-cap', label: 'Education (Cap)' },
        { val: 'gift', label: 'Charity (Gift)' },
        { val: 'briefcase', label: 'Salary (Briefcase)' },
        { val: 'trending-up', label: 'Investments' },
        { val: 'help-circle', label: 'Other (Question)' }
    ];

    let optionsHTML = '';
    iconOptions.forEach(opt => {
        optionsHTML += `<option value="${opt.val}" ${cat.icon === opt.val ? 'selected' : ''}>${opt.label}</option>`;
    });

    tr.innerHTML = `
        <td>
            <input type="text" value="${escapeHtml(cat.name)}" class="bulk-cat-name" data-id="${cat.id}" required placeholder="Category name">
        </td>
        <td>
            <input type="number" value="${cat.budget}" min="0" step="1" class="bulk-cat-budget" required>
        </td>
        <td>
            <input type="color" value="${cat.color}" class="bulk-cat-color" style="width: 50px;">
        </td>
        <td>
            <select class="bulk-cat-icon">
                ${optionsHTML}
            </select>
        </td>
        <td style="text-align: center;">
            <button type="button" class="btn-icon-sm delete" onclick="removeBulkRow(this)" title="Delete Row">
                <i data-lucide="trash-2"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

window.removeBulkRow = function(button) {
    const row = button.closest('tr');
    row.remove();
};

function addBulkRow() {
    appendBulkRowElement();
    lucide.createIcons();
}

async function saveBulkChanges() {
    const rows = document.querySelectorAll('#bulk-categories-rows tr');
    const categories = [];
    const namesSeen = new Set();
    let hasValidationError = false;

    rows.forEach(row => {
        const nameInput = row.querySelector('.bulk-cat-name');
        const budgetInput = row.querySelector('.bulk-cat-budget');
        const colorInput = row.querySelector('.bulk-cat-color');
        const iconInput = row.querySelector('.bulk-cat-icon');

        const id = nameInput.dataset.id || null;
        const name = nameInput.value.trim();
        const budget = parseFloat(budgetInput.value) || 0;
        const color = colorInput.value;
        const icon = iconInput.value;

        if (!name) {
            showToast('Category name cannot be empty.', 'warning');
            hasValidationError = true;
            return;
        }

        if (namesSeen.has(name.toLowerCase())) {
            showToast(`Duplicate category name detected: "${name}"`, 'warning');
            hasValidationError = true;
            return;
        }
        
        namesSeen.add(name.toLowerCase());
        categories.push({ id, name, budget, color, icon });
    });

    if (hasValidationError) return;

    const startingBalance = parseFloat(document.getElementById('bulk-starting-balance').value) || 0.00;

    const payload = {
        categories,
        startingBalance
    };

    try {
        const res = await fetch('/api/categories/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Bulk save failed');

        showToast('All categories and balance updated successfully!', 'success');
        
        await loadDatabaseData();
        closeBulkModal();

        // Refresh views
        if (state.currentView === 'dashboard') {
            renderDashboard();
        } else if (state.currentView === 'budgets') {
            renderBudgetsView();
        }
    } catch (err) {
        console.error(err);
        showToast('Error saving bulk modifications to database.', 'danger');
    }
}

// ==========================================================================
// Self-Chat Feed / Tasks Form Submissions
// ==========================================================================

async function handleChatFormSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    try {
        const res = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (!res.ok) throw new Error('Failed to post reminder note');
        
        input.value = '';
        await loadDatabaseData();
        renderPlannerView();
    } catch (err) {
        console.error(err);
        showToast('Error sending reminder note.', 'danger');
    }
}

async function handleChecklistFormSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('checklist-input');
    const task_text = input.value.trim();
    if (!task_text) return;

    try {
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_text })
        });

        if (!res.ok) throw new Error('Failed to add checklist task');

        input.value = '';
        await loadDatabaseData();
        renderPlannerView();
    } catch (err) {
        console.error(err);
        showToast('Error adding task to checklist.', 'danger');
    }
}

// ==========================================================================
// Formatting & HTML Utility Helpers
// ==========================================================================

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('T')[0].split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return d.toLocaleDateString('en-US', options);
}

// Generates dates relative to today
function getRelativeDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'warning') icon = 'alert-triangle';
    else if (type === 'danger') icon = 'alert-octagon';

    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    // Slide up with show class
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Clear after 3.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 3500);
}
