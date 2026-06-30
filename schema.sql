-- Create Database
CREATE DATABASE IF NOT EXISTS `aurabudget`;
USE `aurabudget`;

-- Drop tables if they exist to start fresh
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `checklist_tasks`;
DROP TABLE IF EXISTS `personal_notes`;

-- Settings Table
CREATE TABLE `settings` (
    `setting_key` VARCHAR(50) PRIMARY KEY,
    `setting_value` VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Categories Table
CREATE TABLE `categories` (
    `id` VARCHAR(50) PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL UNIQUE,
    `budget` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `color` VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    `icon` VARCHAR(50) NOT NULL DEFAULT 'help-circle'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Transactions Table
CREATE TABLE `transactions` (
    `id` VARCHAR(50) PRIMARY KEY,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `type` VARCHAR(10) NOT NULL, -- 'income' or 'expense'
    `category_id` VARCHAR(50),
    `date` DATE NOT NULL,
    FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed Settings
INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES ('starting_balance', '0.00');

-- Seed Categories
INSERT INTO `categories` (`id`, `name`, `budget`, `color`, `icon`) VALUES
('cat-1', 'Food & Dining', 400.00, '#6366f1', 'utensils'),
('cat-2', 'Rent & Housing', 1200.00, '#3b82f6', 'home'),
('cat-3', 'Transportation', 150.00, '#06b6d4', 'car'),
('cat-4', 'Entertainment', 250.00, '#a855f7', 'tv'),
('cat-5', 'Utilities', 200.00, '#f59e0b', 'wrench'),
('cat-6', 'Salary & Income', 0.00, '#10b981', 'briefcase');

-- Seed Transactions (dates relative to current system date)
-- Note: CURRENT_DATE() will be used for dates to make them appear current.
INSERT INTO `transactions` (`id`, `description`, `amount`, `type`, `category_id`, `date`) VALUES
('t-1', 'Monthly Paycheck', 3500.00, 'income', 'cat-6', DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)),
('t-2', 'Apartment Rent Payment', 1100.00, 'expense', 'cat-2', DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)),
('t-3', 'Whole Foods Grocery', 142.50, 'expense', 'cat-1', DATE_SUB(CURRENT_DATE(), INTERVAL 24 DAY)),
('t-4', 'Gas Fill Up', 48.00, 'expense', 'cat-3', DATE_SUB(CURRENT_DATE(), INTERVAL 20 DAY)),
('t-5', 'Netflix Premium Plan', 22.99, 'expense', 'cat-4', DATE_SUB(CURRENT_DATE(), INTERVAL 15 DAY)),
('t-6', 'Water & Gas Bill', 85.00, 'expense', 'cat-5', DATE_SUB(CURRENT_DATE(), INTERVAL 12 DAY)),
('t-7', 'Trader Joe\'s Grocery', 98.40, 'expense', 'cat-1', DATE_SUB(CURRENT_DATE(), INTERVAL 8 DAY)),
('t-8', 'Cinemark Movies & Snacks', 38.50, 'expense', 'cat-4', DATE_SUB(CURRENT_DATE(), INTERVAL 5 DAY)),
('t-9', 'Freelance Design Work', 650.00, 'income', 'cat-6', DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)),
('t-10', 'Uber Ride', 24.00, 'expense', 'cat-3', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY));

-- Personal Notes Table
CREATE TABLE `personal_notes` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `message` TEXT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Checklist Tasks Table
CREATE TABLE `checklist_tasks` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `task_text` VARCHAR(255) NOT NULL,
    `is_completed` BOOLEAN DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed Notes
INSERT INTO `personal_notes` (`message`) VALUES
('Reminder: Review monthly savings rate and transfer $200 to investments.'),
('Remember to cancel movie streaming subscription trial by Friday.'),
('Ideas: Look for cash back credit cards for dining out.');

-- Seed Checklist
INSERT INTO `checklist_tasks` (`task_text`, `is_completed`) VALUES
('File quarterly tax forms', FALSE),
('Pay credit card statement', TRUE),
('Update rent budget limit', FALSE),
('Reconcile freelance invoice deposits', TRUE);

