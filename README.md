#  Xeno CRM Platform - Backend

<div align="center">

![Project](https://img.shields.io/badge/✨_Xeno_CRM-Backend-6366f1?style=for-the-badge&labelColor=8b5cf6)

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-Deployed_App-4285f4?style=for-the-badge)](https://xeno-crm-frontend-two.vercel.app/)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github)](https://github.com/pra9711/xeno-crm-backend.git)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![MySQL](https://img.shields.io/badge/MySQL-Database-4479A1?style=for-the-badge&logo=mysql)](https://www.mysql.com/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma)](https://www.prisma.io/)
[![Google AI](https://img.shields.io/badge/Google_AI-Gemini-4285F4?style=for-the-badge&logo=google)](https://ai.google/)
[![JWT](https://img.shields.io/badge/JWT-Authentication-000000?style=for-the-badge&logo=jsonwebtokens)](https://jwt.io/)
[![Render](https://img.shields.io/badge/Render-Hosted-46E3B7?style=for-the-badge&logo=render)](https://render.com/)

**A powerful backend for customer segmentation, campaign delivery, and AI-driven insights, built for the Xeno SDE Internship Assignment.**

[✨ Features](#-features) • [🚀 Getting Started](#-local-setup-instructions) • [🛠️ Tech Stack](#️-tech-stack) • [🧠 AI & Tech Summary](#-summary-of-ai-tools-and-tech-used) • [⚠️ Limitations](#️-known-limitations--assumptions)

</div>

---

This repository contains the backend service for the Mini CRM Platform. The platform enables customer segmentation, personalized campaign delivery, and AI-powered insights.

This robust backend is built with **Node.js**, **Express**, and **TypeScript**, leveraging **Prisma** for type-safe database interactions with a **MySQL** database. It exposes a secure, well-documented REST API for managing customers, orders, campaigns, and more.

---

## ✨ Features

* **Secure & Flexible Authentication**:
    * Supports both **Google OAuth 2.0** and traditional **email/password** registration.
    * Uses **JWTs** for stateless session management, delivered via secure `httpOnly` cookies in development.
    * Includes CSRF protection for the OAuth flow.
* **Data Ingestion APIs**:
    * Full CRUD REST endpoints to manage `Customers` and `Orders` data.
    * Supports **bulk creation** of customers for efficient data import.
* **Advanced Campaign Management**:
    * Create, view, update, and delete campaigns.
    * **Dynamic Audience Segmentation**: Build complex audience segments using flexible, JSON-based rule logic (`AND`/`OR` conditions).
    * **Audience Preview**: Instantly calculate and preview the audience size for a given set of rules before saving.
    * **Campaign Lifecycle**: Launch, pause, and track campaigns. Launching a campaign asynchronously processes and sends messages for a fast API response.
* **Simulated Campaign Delivery & Logging**:
    * A mock vendor API simulates real-world message delivery with a configurable success rate (~90%).
    * The vendor calls back to a `delivery-receipt` endpoint to update the communication log with the final status (`DELIVERED`, `FAILED`).
* **Comprehensive Analytics Dashboard**:
    * Fetches and aggregates key metrics for customers, orders, revenue, and campaign performance over various timeframes (7, 30, 90 days).
    * Uses raw SQL queries via Prisma for optimized and complex segment analysis.
* **Transactional Integrity**:
    * Leverages `prisma.$transaction` to ensure database operations are atomic. For example, creating an order also updates the customer's `totalSpending` and `visitCount` in a single, safe transaction.
* **AI-Powered Insights**:
    * **Natural Language to Segment Rules**: Converts plain English prompts (e.g., "users who spent over 5000 and visited 3 times") into logical JSON rules. Uses a hybrid approach with local heuristics and a fallback to external providers like Google Gemini.
    * **AI Message Suggestions**: Generates personalized message variants based on a campaign's objective.

---

## 🛠️ Tech Stack

* **Backend**: Node.js, Express.js
* **Language**: TypeScript
* **Database**: MySQL
* **ORM**: Prisma
* **Authentication**: JSON Web Tokens (JWT), Google OAuth 2.0, `bcrypt.js`
* **API Validation**: `express-validator`, Zod
* **AI Integration**: Google Gemini, OpenAI (or other public LLM APIs)
* **Security & Middleware**: Helmet, CORS, `express-rate-limit`
* **Dev Tools**: Nodemon, ts-node, Morgan

---

## 🏗️ Architecture Diagram



<br/>
<img width="3840" height="2390" alt="Untitled diagram _ Mermaid Chart-2025-09-15-191632" src="https://github.com/user-attachments/assets/4b60cb12-a935-4d4f-bc2d-5c1a2fc5c217" />

<br/>

---

## 🏗️ ER Diagram
<img width="3840" height="2996" alt="Untitled diagram _ Mermaid Chart-2025-09-15-192326" src="https://github.com/user-attachments/assets/26649bf2-fdd5-4406-bcbd-63698a695a34" />


---

## 🚀 Local Setup Instructions

Follow these steps to get the backend server running on your local machine.

### Prerequisites

* [Node.js](https://nodejs.org/) (v18 or higher)
* [NPM](https://www.npmjs.com/)
* [MySQL](https://www.mysql.com/downloads/) or a Docker container running MySQL.

### 1. Clone the Repository

```bash
git clone https://github.com/pra9711/xeno-crm-backend
cd xeno-crm-backend
```


### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a .env file in the root of the project by copying the example file:

```bash
cp .env.example .env
```

Now, fill in the .env file with your specific configurations.

```bash

# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database URL (using Prisma's format for MySQL)
DATABASE_URL="mysql://root:password@localhost:3306/mini_crm"

# Authentication
JWT_SECRET="your-super-secret-jwt-key"

# Google OAuth Credentials
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3001/api/auth/google/callback"

# Vendor API Simulation
VENDOR_API_URL="http://localhost:3001/api/vendor"
VENDOR_API_KEY="a-secret-key-for-the-mock-vendor"

# Optional: AI Provider API Keys
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_API_URL="[https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent](https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent)"
# OPENAI_API_KEY="your-openai-api-key"

# Optional: Development Flags
BACKEND_DEV_TOKEN_FALLBACK=true
ANALYTICS_DEV_MOCK=true
```

### 4. Set Up the Database
Run the Prisma migrations to create the database schema and tables defined in prisma/schema.prisma.

```bash
npx prisma migrate dev
```

### 5. (Optional) Seed the Database
To populate the database with some initial sample data, run the seed script.

```bash
npx prisma db seed
```

### 6. Run the Server
Start the development server. It will automatically restart on file changes.

```bash
npm run dev
```

The server should now be running at http://localhost:3001. You can check its status by visiting the health check endpoint: http://localhost:3001/health.

## 🧠 Summary of AI Tools and Tech Used
This project leverages several modern technologies to deliver a feature-rich experience.

* **AI Integration**: The core of the intelligent features resides in `routes/ai.ts`. The system is designed to connect to external Large Language Model (LLM) APIs like Google Gemini or OpenAI.
    * The `nl-to-rules` endpoint uses a **hybrid approach**: it first tries local heuristics (regex and keyword matching) for speed and cost-effectiveness. If the result is weak or an API key is present, it can call an external provider for more accurate natural language understanding. This ensures baseline functionality even without an API key.
* **Prisma ORM**: We chose Prisma as the Object-Relational Mapper to interact with our MySQL database. It provides excellent auto-completion, type safety, and a streamlined way to manage database schemas through migrations (`prisma/schema.prisma`). For complex queries, like in the analytics routes, it allows for safe execution of raw SQL for optimal performance.
* **Transactional Guarantees**: Several critical operations, like creating an order or launching a campaign, are wrapped in `prisma.$transaction`. This ensures that multiple related database updates either all succeed or all fail together, maintaining data integrity. For instance, when a new order is created, the order is inserted *and* the customer's lifetime value is updated atomically.

---

## ⚠️ Known Limitations & Assumptions
* **Mocked Analytics Data**: Several analytics components rely on mocked data as placeholders, since the core data models do not contain the necessary fields. This includes geographic distributions, top-performing products, and engagement metrics (open/click rates).
* **Synchronous Data Ingestion**: The assignment suggests a pub-sub architecture as a "brownie point" for scalability. This implementation uses a standard synchronous API for data ingestion. For very high-volume writes, this could become a bottleneck.
* **Background Task Execution**: The campaign launch process triggers message sending as an asynchronous, "fire-and-forget" task. While this provides a fast API response, any errors that occur during the background sending process are logged to the console but not directly reported back to the user who initiated the launch.
* **Database-Dependent Search**: The search functionality in the customer routes relies on the default case-insensitivity of the configured MySQL collation. This behavior might differ if deployed with a different database or a case-sensitive collation.
