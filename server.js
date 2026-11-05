// Product Management System - Express + MySQL
// Run: npm install && npm start

"use strict";

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "maaz"; // Change in your local environment if needed.
const DB_NAME = process.env.DB_NAME || "product_management";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let db;

function sendError(res, error, fallback = "A server error occurred.") {
    console.error(error);
    if (error && error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "This Product ID already exists. Please use a different ID." });
    }
    return res.status(500).json({ message: error.message || fallback });
}

function validateProduct(body) {
    const product_code = String(body.product_code ?? "").trim();
    const product_name = String(body.product_name ?? "").trim();
    const category = String(body.category ?? "").trim();
    const price = Number(body.price);
    const quantity = Number(body.quantity);
    const reorder_level = Number(body.reorder_level);

    if (!product_code || product_code.length > 50) {
        return { error: "Enter a Product ID (1–50 characters)." };
    }
    if (!product_name || product_name.length > 150) {
        return { error: "Enter a product name (maximum 150 characters)." };
    }
    if (!category) {
        return { error: "Please select a product category." };
    }
    if (body.price === "" || body.price === null || body.price === undefined ||
        !Number.isFinite(price) || price < 0 || price > 99999999.99) {
        return { error: "Enter a valid non-negative product price." };
    }
    if (body.quantity === "" || body.quantity === null || body.quantity === undefined ||
        !Number.isSafeInteger(quantity) || quantity < 0) {
        return { error: "Quantity must be a non-negative whole number." };
    }
    if (body.reorder_level === "" || body.reorder_level === null || body.reorder_level === undefined ||
        !Number.isSafeInteger(reorder_level) || reorder_level < 0) {
        return { error: "Reorder level must be a non-negative whole number." };
    }

    return {
        value: { product_code, product_name, category, price, quantity, reorder_level }
    };
}

async function initializeDatabase() {
    // Connect without selecting a database so the database can be created if necessary.
    const setup = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD
    });

    await setup.query(
        `CREATE DATABASE IF NOT EXISTS \`${DB_NAME.replace(/`/g, "")}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await setup.end();

    db = mysql.createPool({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    // Create the table for a fresh installation. Existing products tables are retained.
    await db.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            product_code VARCHAR(50) NULL,
            product_name VARCHAR(150) NOT NULL,
            category VARCHAR(100) NOT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0,
            quantity INT NOT NULL DEFAULT 0,
            reorder_level INT NOT NULL DEFAULT 10,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);

    // Add Product ID to an existing table without deleting existing products.
    const [columns] = await db.query(
        `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'product_code'`,
        [DB_NAME]
    );

    if (columns.length === 0) {
        await db.query("ALTER TABLE products ADD COLUMN product_code VARCHAR(50) NULL");
    }

    // Give older rows a stable Product ID so existing records remain visible and editable.
    await db.query(`
        UPDATE products
           SET product_code = CONCAT('LEGACY-', id)
         WHERE product_code IS NULL OR TRIM(product_code) = ''
    `);

    // Add a unique index once. Product IDs are unique and case-insensitive in MySQL's
    // standard utf8mb4_unicode_ci collation.
    const [indexes] = await db.query(
        `SELECT INDEX_NAME
           FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND INDEX_NAME = 'uq_products_product_code'`,
        [DB_NAME]
    );
    if (indexes.length === 0) {
        await db.query(
            "ALTER TABLE products ADD UNIQUE INDEX uq_products_product_code (product_code)"
        );
    }

    console.log(`Connected to MySQL database: ${DB_NAME}`);
    console.log("Product ID field is ready.");
}

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Product Management API is running." });
});

// READ all products
app.get("/api/products", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM products ORDER BY id DESC");
        res.json(rows);
    } catch (error) {
        sendError(res, error);
    }
});

// READ one product (internal numeric database ID, used by edit/delete buttons)
app.get("/api/products/:id", async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: "Product not found." });
        res.json(rows[0]);
    } catch (error) {
        sendError(res, error);
    }
});

// CREATE product
app.post("/api/products", async (req, res) => {
    const checked = validateProduct(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });

    const p = checked.value;
    try {
        const [result] = await db.query(
            `INSERT INTO products
                (product_code, product_name, category, price, quantity, reorder_level)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [p.product_code, p.product_name, p.category, p.price, p.quantity, p.reorder_level]
        );
        res.status(201).json({
            message: "Product added successfully.",
            id: result.insertId,
            product_code: p.product_code
        });
    } catch (error) {
        sendError(res, error);
    }
});

// UPDATE product
app.put("/api/products/:id", async (req, res) => {
    const checked = validateProduct(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });

    const p = checked.value;
    try {
        const [result] = await db.query(
            `UPDATE products
                SET product_code = ?, product_name = ?, category = ?, price = ?,
                    quantity = ?, reorder_level = ?
              WHERE id = ?`,
            [p.product_code, p.product_name, p.category, p.price, p.quantity, p.reorder_level, req.params.id]
        );
        if (result.affectedRows === 0) {
            const [rows] = await db.query("SELECT id FROM products WHERE id = ?", [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ message: "Product not found." });
        }
        res.json({ message: "Product updated successfully." });
    } catch (error) {
        sendError(res, error);
    }
});

// DELETE product
app.delete("/api/products/:id", async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM products WHERE id = ?", [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Product not found." });
        res.json({ message: "Product deleted successfully." });
    } catch (error) {
        sendError(res, error);
    }
});

// Return JSON for unknown API routes rather than an HTML error page.
app.use("/api", (req, res) => {
    res.status(404).json({ message: "API route not found." });
});

async function start() {
    try {
        await initializeDatabase();
        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("Open the application at http://localhost:3000");
        });
    } catch (error) {
        console.error("\nUnable to start the application.");
        console.error("Check that MySQL Server is running and that the MySQL username/password are correct.");
        console.error("MySQL error:", error.message);
        process.exit(1);
    }
}

start();
