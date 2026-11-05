
"use strict";

/* =========================================================
   PRODUCT MANAGEMENT SYSTEM
   File: frontend/script.js

   Frontend API:
   http://localhost:3000/api/products
   ========================================================= */


/* ---------- 1. CONFIGURATION ---------- */

const API_BASE_URL = "http://localhost:3000/api/products";

const ITEMS_PER_PAGE = 8;

let products = [];
let currentPage = 1;
let editingProductId = null;
let toastTimeout = null;
let isSaving = false;


/* ---------- 2. DOM ELEMENT REFERENCES ---------- */

const elements = {
    sidebar: document.getElementById("sidebar"),
    menuToggle: document.getElementById("menuToggle"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),

    globalSearch: document.getElementById("globalSearch"),
    productSearch: document.getElementById("productSearch"),
    categoryFilter: document.getElementById("categoryFilter"),
    sortFilter: document.getElementById("sortFilter"),

    totalProducts: document.getElementById("totalProducts"),
    totalQuantity: document.getElementById("totalQuantity"),
    lowStockCount: document.getElementById("lowStockCount"),
    inventoryValue: document.getElementById("inventoryValue"),

    sidebarLowStock: document.getElementById("sidebarLowStock"),
    inStockCount: document.getElementById("inStockCount"),
    reportLowStock: document.getElementById("reportLowStock"),
    outOfStockCount: document.getElementById("outOfStockCount"),

    productTableBody: document.getElementById("productTableBody"),
    tableInfo: document.getElementById("tableInfo"),
    currentPage: document.getElementById("currentPage"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),

    productForm: document.getElementById("productForm"),
    productId: document.getElementById("productId"),
    productCode: document.getElementById("productCode"),
    productName: document.getElementById("productName"),
    productCategory: document.getElementById("productCategory"),
    productPrice: document.getElementById("productPrice"),
    productQuantity: document.getElementById("productQuantity"),
    reorderLevel: document.getElementById("reorderLevel"),

    formTitle: document.getElementById("formTitle"),
    submitProduct: document.getElementById("submitProduct"),
    cancelEdit: document.getElementById("cancelEdit"),
    formMessage: document.getElementById("formMessage"),

    lowStockList: document.getElementById("lowStockList"),

    refreshButton: document.getElementById("refreshButton"),
    quickAddButton: document.getElementById("quickAddButton"),
    exportButton: document.getElementById("exportButton"),

    toast: document.getElementById("toast")
};


/* ---------- 3. GENERAL HELPERS ---------- */

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return replacements[character];
    });
}


function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}


function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(toNumber(value));
}


function formatNumber(value) {
    return new Intl.NumberFormat("en-IN").format(toNumber(value));
}


function getProductStatus(product) {
    const quantity = toNumber(product.quantity);
    const reorderLevel = toNumber(product.reorder_level);

    if (quantity === 0) {
        return {
            text: "Out of Stock",
            className: "out-of-stock"
        };
    }

    if (quantity <= reorderLevel) {
        return {
            text: "Low Stock",
            className: "low-stock"
        };
    }

    return {
        text: "In Stock",
        className: "in-stock"
    };
}


function showToast(message, type = "success") {
    if (!elements.toast) return;

    clearTimeout(toastTimeout);

    elements.toast.textContent = message;
    elements.toast.className = `toast show ${type}`;

    toastTimeout = setTimeout(() => {
        elements.toast.className = "toast";
    }, 3500);
}


function showFormMessage(message, type = "success") {
    elements.formMessage.textContent = message;
    elements.formMessage.className = `form-message ${type}`;
}


function clearFormMessage() {
    elements.formMessage.textContent = "";
    elements.formMessage.className = "form-message";
}


function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }
}


/* ---------- 4. API REQUEST HELPER ---------- */

async function apiRequest(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            ...options,
            headers: {
                ...(options.body ? {
                    "Content-Type": "application/json"
                } : {}),
                ...options.headers
            }
        });
    } catch (error) {
        throw new Error(
            "Cannot connect to the backend. Make sure Node.js is running on port 3000."
        );
    }

    if (!response.ok) {
        let message = `Request failed with status ${response.status}.`;

        try {
            const errorData = await response.json();
            message = errorData.message || errorData.error || message;
        } catch {
            // Keep the default HTTP error message.
        }

        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
        throw new Error(
            "The backend did not return JSON. Check your Express API route."
        );
    }

    return response.json();
}


/* ---------- 5. LOAD PRODUCTS FROM MYSQL VIA EXPRESS ---------- */

async function loadProducts() {
    elements.refreshButton.disabled = true;

    try {
        const data = await apiRequest(API_BASE_URL);

        // Accept either an array or { products: [...] }.
        const records = Array.isArray(data)
            ? data
            : data?.products;

        if (!Array.isArray(records)) {
            throw new Error(
                "Invalid API response. Expected an array of products."
            );
        }

        products = records.map(product => ({
            ...product,
            id: Number(product.id),
            product_code: product.product_code || String(product.id),
            price: toNumber(product.price),
            quantity: toNumber(product.quantity),
            reorder_level: toNumber(product.reorder_level)
        }));

        // Keep the current page valid after changes.
        renderDashboard();
        renderProductTable();
        renderLowStockList();

    } catch (error) {
        console.error("Loading products failed:", error);

        showToast(error.message, "error");

        elements.productTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <strong>Unable to load products</strong>
                    <span>${escapeHTML(error.message)}</span>
                </td>
            </tr>
        `;

        elements.tableInfo.textContent = "Products could not be loaded";

    } finally {
        elements.refreshButton.disabled = false;
        refreshIcons();
    }
}


/* ---------- 6. DASHBOARD STATISTICS ---------- */

function renderDashboard() {
    const totalProducts = products.length;

    const totalQuantity = products.reduce(
        (sum, product) => sum + product.quantity,
        0
    );

    const inventoryValue = products.reduce(
        (sum, product) => sum + product.price * product.quantity,
        0
    );

    const lowStockProducts = products.filter(product =>
        product.quantity > 0 &&
        product.quantity <= product.reorder_level
    );

    const outOfStockProducts = products.filter(product =>
        product.quantity === 0
    );

    const inStockProducts = products.filter(product =>
        product.quantity > product.reorder_level
    );

    elements.totalProducts.textContent = formatNumber(totalProducts);
    elements.totalQuantity.textContent = formatNumber(totalQuantity);
    elements.lowStockCount.textContent = formatNumber(
        lowStockProducts.length
    );
    elements.inventoryValue.textContent = formatCurrency(inventoryValue);

    elements.sidebarLowStock.textContent = formatNumber(
        lowStockProducts.length + outOfStockProducts.length
    );

    elements.inStockCount.textContent = formatNumber(
        inStockProducts.length
    );

    elements.reportLowStock.textContent = formatNumber(
        lowStockProducts.length
    );

    elements.outOfStockCount.textContent = formatNumber(
        outOfStockProducts.length
    );
}


/* ---------- 7. SEARCH, FILTER AND SORT ---------- */

function getFilteredProducts() {
    const searchText = (
        elements.productSearch.value ||
        elements.globalSearch.value ||
        ""
    ).trim().toLowerCase();

    const category = elements.categoryFilter.value;
    const sortOrder = elements.sortFilter.value;

    let filteredProducts = products.filter(product => {
        const name = String(product.product_name || "").toLowerCase();
        const productCategory = String(product.category || "").toLowerCase();
        const id = String(product.id);
        const productCode = String(product.product_code || "");

        const matchesSearch =
            name.includes(searchText) ||
            productCategory.includes(searchText) ||
            id.includes(searchText) ||
            productCode.toLowerCase().includes(searchText);

        const matchesCategory =
            !category || product.category === category;

        return matchesSearch && matchesCategory;
    });

    filteredProducts.sort((a, b) => {
        switch (sortOrder) {
            case "name-desc":
                return String(b.product_name).localeCompare(
                    String(a.product_name)
                );

            case "price-asc":
                return a.price - b.price;

            case "price-desc":
                return b.price - a.price;

            case "quantity-asc":
                return a.quantity - b.quantity;

            case "quantity-desc":
                return b.quantity - a.quantity;

            case "name-asc":
            default:
                return String(a.product_name).localeCompare(
                    String(b.product_name)
                );
        }
    });

    return filteredProducts;
}


/* ---------- 8. PRODUCT TABLE ---------- */

function renderProductTable() {
    const filteredProducts = getFilteredProducts();

    const totalFiltered = filteredProducts.length;

    const totalPages = Math.max(
        1,
        Math.ceil(totalFiltered / ITEMS_PER_PAGE)
    );

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;

    const visibleProducts = filteredProducts.slice(
        startIndex,
        startIndex + ITEMS_PER_PAGE
    );

    if (visibleProducts.length === 0) {
        const isSearchActive =
            elements.productSearch.value.trim() ||
            elements.globalSearch.value.trim() ||
            elements.categoryFilter.value;

        elements.productTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <strong>${isSearchActive
                        ? "No matching products"
                        : "No products found"}</strong>
                    <span>${isSearchActive
                        ? "Try another search or category."
                        : "Add a product using the form."}</span>
                </td>
            </tr>
        `;
    } else {
        elements.productTableBody.innerHTML = visibleProducts.map(
            (product, index) => {
                const status = getProductStatus(product);

                return `
                    <tr>
                        <td>${escapeHTML(product.product_code || product.id)}</td>

                        <td>${escapeHTML(product.product_name)}</td>

                        <td>${escapeHTML(product.category)}</td>

                        <td>${formatCurrency(product.price)}</td>

                        <td>${formatNumber(product.quantity)}</td>

                        <td>${formatNumber(product.reorder_level)}</td>

                        <td>
                            <span class="status-badge ${status.className}">
                                ${status.text}
                            </span>
                        </td>

                        <td>
                            <div class="action-buttons">
                                <button
                                    type="button"
                                    class="action-btn edit-btn"
                                    data-action="edit"
                                    data-id="${escapeHTML(product.id)}"
                                    aria-label="Edit ${escapeHTML(product.product_name)}"
                                    title="Edit product">
                                    <i data-lucide="pencil"></i>
                                </button>

                                <button
                                    type="button"
                                    class="action-btn delete-btn"
                                    data-action="delete"
                                    data-id="${escapeHTML(product.id)}"
                                    aria-label="Delete ${escapeHTML(product.product_name)}"
                                    title="Delete product">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }
        ).join("");
    }

    const firstItem = totalFiltered === 0 ? 0 : startIndex + 1;
    const lastItem = Math.min(startIndex + ITEMS_PER_PAGE, totalFiltered);

    elements.tableInfo.textContent =
        `Showing ${firstItem}-${lastItem} of ${totalFiltered} products`;

    elements.currentPage.textContent = `${currentPage} / ${totalPages}`;

    elements.prevPage.disabled = currentPage <= 1;
    elements.nextPage.disabled = currentPage >= totalPages;

    refreshIcons();
}


/* ---------- 9. LOW-STOCK ALERT LIST ---------- */

function renderLowStockList() {
    const alertProducts = products
        .filter(product =>
            product.quantity <= product.reorder_level
        )
        .sort((a, b) => a.quantity - b.quantity);

    if (alertProducts.length === 0) {
        elements.lowStockList.innerHTML = `
            <div class="low-stock-empty">
                <i data-lucide="shield-check"></i>
                <p>All products are above their reorder levels.</p>
            </div>
        `;

        refreshIcons();
        return;
    }

    elements.lowStockList.innerHTML = alertProducts
        .slice(0, 10)
        .map(product => {
            const status = getProductStatus(product);

            return `
                <div class="low-stock-item">
                    <div class="low-stock-item-info">
                        <strong>${escapeHTML(product.product_name)}</strong>
                        <span>${escapeHTML(product.category)}</span>
                    </div>

                    <div class="low-stock-item-meta">
                        <span class="low-stock-quantity">
                            ${formatNumber(product.quantity)}
                            / ${formatNumber(product.reorder_level)}
                        </span>

                        <span class="status-badge ${status.className}">
                            ${status.text}
                        </span>
                    </div>
                </div>
            `;
        })
        .join("");

    refreshIcons();
}


/* ---------- 10. FORM VALIDATION ---------- */

function getFormData() {
    const productCode = elements.productCode.value.trim();
    const productName = elements.productName.value.trim();
    const category = elements.productCategory.value;

    if (!productCode) {
        throw new Error("Please enter a Product ID.");
    }

    const duplicateCode = products.find(product =>
        String(product.product_code || product.id).toLowerCase() === productCode.toLowerCase() &&
        String(product.id) !== String(editingProductId)
    );

    if (duplicateCode) {
        throw new Error("This Product ID already exists. Please enter a unique ID.");
    }

    const price = Number(elements.productPrice.value);
    const quantity = Number(elements.productQuantity.value);
    const reorderLevel = Number(elements.reorderLevel.value);

    if (!productName) {
        throw new Error("Please enter a product name.");
    }

    if (!category) {
        throw new Error("Please select a product category.");
    }

    if (
        elements.productPrice.value.trim() === "" ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > 99999999.99
    ) {
        throw new Error("Enter a valid price between ₹0 and ₹99,999,999.99.");
    }

    if (
        elements.productQuantity.value.trim() === "" ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0
    ) {
        throw new Error("Quantity must be a non-negative whole number.");
    }

    if (
        elements.reorderLevel.value.trim() === "" ||
        !Number.isSafeInteger(reorderLevel) ||
        reorderLevel < 0
    ) {
        throw new Error("Reorder level must be a non-negative whole number.");
    }

    return {
        product_code: productCode,
        product_name: productName,
        category,
        price,
        quantity,
        reorder_level: reorderLevel
    };
}


/* ---------- 11. ADD OR UPDATE PRODUCT ---------- */

async function saveProduct(event) {
    event.preventDefault();

    if (isSaving) return;

    clearFormMessage();

    if (!elements.productForm.reportValidity()) {
        return;
    }

    let productData;

    try {
        productData = getFormData();
    } catch (error) {
        showFormMessage(error.message, "error");
        return;
    }

    const productId = editingProductId;

    const url = productId
        ? `${API_BASE_URL}/${encodeURIComponent(productId)}`
        : API_BASE_URL;

    const method = productId ? "PUT" : "POST";

    isSaving = true;
    elements.submitProduct.disabled = true;
    elements.submitProduct.textContent = productId
        ? "Updating..."
        : "Saving...";

    try {
        await apiRequest(url, {
            method,
            body: JSON.stringify(productData)
        });

        resetProductForm();

        // Reload authoritative data from MySQL.
        await loadProducts();

        showToast(
            productId
                ? "Product updated successfully."
                : "Product added successfully.",
            "success"
        );

        // Bring the product table into view.
        document.getElementById("products").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    } catch (error) {
        console.error("Saving product failed:", error);
        showFormMessage(error.message, "error");
        showToast(error.message, "error");

    } finally {
        isSaving = false;
        elements.submitProduct.disabled = false;
        updateSubmitButton();
        refreshIcons();
    }
}


/* ---------- 12. RESET FORM ---------- */

function resetProductForm() {
    elements.productForm.reset();

    editingProductId = null;
    elements.productId.value = "";

    elements.formTitle.textContent = "Add New Product";
    elements.cancelEdit.hidden = true;

    clearFormMessage();
    updateSubmitButton();
}


function updateSubmitButton() {
    const iconName = editingProductId ? "save" : "plus";
    const buttonText = editingProductId
        ? "Update Product"
        : "Save Product";

    elements.submitProduct.innerHTML = `
        <i data-lucide="${iconName}"></i>
        ${buttonText}
    `;

    refreshIcons();
}


/* ---------- 13. EDIT PRODUCT ---------- */

function editProduct(productId) {
    const product = products.find(
        item => String(item.id) === String(productId)
    );

    if (!product) {
        showToast("Product not found. Refresh and try again.", "error");
        return;
    }

    editingProductId = product.id;

    elements.productId.value = product.id;
    elements.productCode.value = product.product_code || product.id;
    elements.productName.value = product.product_name;
    elements.productCategory.value = product.category;
    elements.productPrice.value = product.price;
    elements.productQuantity.value = product.quantity;
    elements.reorderLevel.value = product.reorder_level;

    elements.formTitle.textContent = "Edit Product";
    elements.cancelEdit.hidden = false;

    clearFormMessage();
    updateSubmitButton();

    document.getElementById("add-product").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    elements.productName.focus();
}


/* ---------- 14. DELETE PRODUCT ---------- */

async function deleteProduct(productId) {
    const product = products.find(
        item => String(item.id) === String(productId)
    );

    if (!product) {
        showToast("Product not found. Refresh and try again.", "error");
        return;
    }

    const confirmed = window.confirm(
        `Are you sure you want to delete "${product.product_name}"?`
    );

    if (!confirmed) return;

    try {
        await apiRequest(
            `${API_BASE_URL}/${encodeURIComponent(productId)}`,
            { method: "DELETE" }
        );

        if (String(editingProductId) === String(productId)) {
            resetProductForm();
        }

        await loadProducts();

        showToast("Product deleted successfully.", "success");

    } catch (error) {
        console.error("Deleting product failed:", error);
        showToast(error.message, "error");
    }
}


/* ---------- 15. TABLE ACTION HANDLER ---------- */

function handleTableAction(event) {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const productId = button.dataset.id;

    if (button.dataset.action === "edit") {
        editProduct(productId);
    }

    if (button.dataset.action === "delete") {
        deleteProduct(productId);
    }
}


/* ---------- 16. PAGINATION ---------- */

function changePage(direction) {
    const filteredProducts = getFilteredProducts();

    const totalPages = Math.max(
        1,
        Math.ceil(filteredProducts.length / ITEMS_PER_PAGE)
    );

    currentPage = Math.max(
        1,
        Math.min(totalPages, currentPage + direction)
    );

    renderProductTable();
}


/* ---------- 17. SEARCH AND FILTER EVENTS ---------- */

function handleSearch() {
    currentPage = 1;
    renderProductTable();
}


function handleGlobalSearch() {
    // Keep both search boxes synchronized.
    elements.productSearch.value = elements.globalSearch.value;

    handleSearch();
}


function handleTableSearch() {
    elements.globalSearch.value = elements.productSearch.value;

    handleSearch();
}


/* ---------- 18. CSV EXPORT ---------- */

function exportProductsCSV() {
    const filteredProducts = getFilteredProducts();

    if (filteredProducts.length === 0) {
        showToast("There are no products to export.", "error");
        return;
    }

    const headers = [
        "Product ID",
        "Product Name",
        "Category",
        "Price",
        "Quantity",
        "Reorder Level",
        "Status"
    ];

    const rows = filteredProducts.map(product => {
        const status = getProductStatus(product);

        return [
            product.product_code || product.id,
            product.product_name,
            product.category,
            product.price.toFixed(2),
            product.quantity,
            product.reorder_level,
            status.text
        ];
    });

    // Prevent spreadsheet formula injection in text fields.
    function csvCell(value) {
        let text = String(value ?? "");

        if (/^[\s]*[=+\-@]/.test(text)) {
            text = "'" + text;
        }

        return '"' + text.replace(/"/g, '""') + '"';
    }

    const csvContent = [
        headers,
        ...rows
    ]
        .map(row => row.map(csvCell).join(","))
        .join("\r\n");

    // UTF-8 BOM helps Excel display text correctly.
    const blob = new Blob(
        ["\uFEFF", csvContent],
        { type: "text/csv;charset=utf-8;" }
    );

    const downloadURL = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadURL;
    link.download = "product-inventory.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadURL);

    showToast("CSV report exported successfully.", "success");
}


/* ---------- 19. MOBILE SIDEBAR ---------- */

function openSidebar() {
    elements.sidebar.classList.add("open");
    elements.sidebarBackdrop.classList.add("show");

    elements.menuToggle.setAttribute("aria-expanded", "true");
}


function closeSidebar() {
    elements.sidebar.classList.remove("open");
    elements.sidebarBackdrop.classList.remove("show");

    elements.menuToggle.setAttribute("aria-expanded", "false");
}


function toggleSidebar() {
    if (elements.sidebar.classList.contains("open")) {
        closeSidebar();
    } else {
        openSidebar();
    }
}


/* ---------- 20. SIDEBAR NAVIGATION ---------- */

function handleNavigation(event) {
    const link = event.target.closest(".nav-link");

    if (!link) return;

    document.querySelectorAll(".nav-link").forEach(item => {
        item.classList.remove("active");
    });

    link.classList.add("active");

    closeSidebar();

    const sectionId = link.dataset.section;
    const section = document.getElementById(sectionId);

    if (section) {
        section.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
}


function setupNavigationObserver() {
    const navLinks = document.querySelectorAll(".nav-link");

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(entries => {
        const visibleSections = entries
            .filter(entry => entry.isIntersecting)
            .sort((a, b) =>
                b.intersectionRatio - a.intersectionRatio
            );

        if (visibleSections.length === 0) return;

        const visibleId = visibleSections[0].target.id;

        navLinks.forEach(link => {
            link.classList.toggle(
                "active",
                link.dataset.section === visibleId
            );
        });
    }, {
        rootMargin: "-90px 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5]
    });

    navLinks.forEach(link => {
        const section = document.getElementById(link.dataset.section);

        if (section) observer.observe(section);
    });
}


/* ---------- 21. REGISTER ALL EVENTS ---------- */

function registerEventListeners() {
    elements.productForm.addEventListener("submit", saveProduct);

    elements.cancelEdit.addEventListener("click", resetProductForm);

    elements.productTableBody.addEventListener(
        "click",
        handleTableAction
    );

    elements.productSearch.addEventListener(
        "input",
        handleTableSearch
    );

    elements.globalSearch.addEventListener(
        "input",
        handleGlobalSearch
    );

    elements.categoryFilter.addEventListener("change", () => {
        currentPage = 1;
        renderProductTable();
    });

    elements.sortFilter.addEventListener("change", () => {
        currentPage = 1;
        renderProductTable();
    });

    elements.prevPage.addEventListener("click", () => {
        changePage(-1);
    });

    elements.nextPage.addEventListener("click", () => {
        changePage(1);
    });

    elements.refreshButton.addEventListener("click", loadProducts);

    elements.quickAddButton.addEventListener("click", () => {
        resetProductForm();

        document.getElementById("add-product").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        elements.productName.focus();
    });

    elements.exportButton.addEventListener(
        "click",
        exportProductsCSV
    );

    elements.menuToggle.addEventListener(
        "click",
        toggleSidebar
    );

    elements.sidebarBackdrop.addEventListener(
        "click",
        closeSidebar
    );

    document.querySelector(".sidebar-nav").addEventListener(
        "click",
        handleNavigation
    );

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeSidebar();
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 850) {
            closeSidebar();
        }
    });
}


/* ---------- 22. INITIALIZE APPLICATION ---------- */

function initializeApp() {
    registerEventListeners();
    setupNavigationObserver();
    refreshIcons();
    updateSubmitButton();

    // Fetch products from Express.js / MySQL.
    loadProducts();
}

document.addEventListener("DOMContentLoaded", initializeApp);
