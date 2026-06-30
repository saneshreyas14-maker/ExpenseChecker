-- Create Database
CREATE DATABASE IF NOT EXISTS `aurabudget`;
USE `aurabudget`;

-- Settings Table
CREATE TABLE IF NOT EXISTS `settings` (
    `setting_key` VARCHAR(50) PRIMARY KEY,
    `setting_value` VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Categories Table
CREATE TABLE IF NOT EXISTS `categories` (
    `id` VARCHAR(50) PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL UNIQUE,
    `budget` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `color` VARCHAR(7) NOT NULL DEFAULT '#6366f1',
    `icon` VARCHAR(50) NOT NULL DEFAULT 'help-circle'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Transactions Table
CREATE TABLE IF NOT EXISTS `transactions` (
    `id` VARCHAR(50) PRIMARY KEY,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `type` VARCHAR(10) NOT NULL, -- 'income' or 'expense'
    `category_id` VARCHAR(50),
    `date` DATE NOT NULL,
    FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Personal Notes Table
CREATE TABLE IF NOT EXISTS `personal_notes` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `message` TEXT NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Checklist Tasks Table
CREATE TABLE IF NOT EXISTS `checklist_tasks` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `task_text` VARCHAR(255) NOT NULL,
    `is_completed` BOOLEAN DEFAULT FALSE,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed Settings (Base System Setting)
INSERT IGNORE INTO `settings` (`setting_key`, `setting_value`) VALUES ('starting_balance', '0.00');
