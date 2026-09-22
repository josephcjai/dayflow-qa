# DayFlow REST API Documentation

**Version:** 2.4.0  
**Base URL (Local):** `http://localhost:5000/api`  
**Base URL (Production HTTPS):** `https://<your_domain>/api`  
**Authentication Method:** JSON Web Token (`Authorization: Bearer <token>`)

---

## 🔒 Authentication Headers

All protected endpoints require an `Authorization` HTTP header with a valid JWT token obtained from `POST /api/auth/login` or `POST /api/auth/register`:

```http
Authorization: Bearer <your_jwt_token_here>
Content-Type: application/json
```

---

## 📅 Global Date Sanity Validation Rules

All date parameters across the API (`weekStart`, `dueDate`, `slotKey` date prefix, and habit `logTime` date prefix) enforce calendar sanity bounds:
- **Format:** `YYYY-MM-DD` (e.g. `2026-08-10`)
- **Range:** Must be between `1800-01-01` and `2200-12-31` (inclusive)
- **Validation:** Dates must represent real calendar dates. Any date outside this range or invalid dates (such as `2026-02-30`) return `400 Bad Request`.

---

## 1. Authentication Endpoints (`/api/auth`)

### 1.1 Register New Account

- **URL:** `POST /api/auth/register`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "displayName": "User Name"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Registration successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "user": {
      "id": "e4f8b6b1-0987-4321-abcd-123456789abc",
      "email": "user@example.com",
      "displayName": "User Name",
      "hasPassword": true
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    - `{ "error": "Email and password are required" }`
    - `{ "error": "Email and password must be valid strings" }`
    - `{ "error": "Email address cannot exceed 255 characters" }`
    - `{ "error": "Display name must be a string" }`
    - `{ "error": "Display name cannot exceed 100 characters" }`
    - `{ "error": "Password must be at least 6 characters long" }`
    - `{ "error": "Password cannot exceed 72 characters" }`
    - `{ "error": "Password cannot exceed 72 bytes" }`
    - `{ "error": "An account with this email already exists. Please sign in." }`

---

### 1.2 User Login

- **URL:** `POST /api/auth/login`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "user": {
      "id": "e4f8b6b1-0987-4321-abcd-123456789abc",
      "email": "user@example.com",
      "displayName": "User Name",
      "hasPassword": true
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    - `{ "error": "Email and password are required" }`
    - `{ "error": "Email and password must be valid strings" }`
  - `401 Unauthorized`:
    - `{ "error": "Invalid email or password." }`
    - `{ "error": "This account was created with Google Sign-In. Please continue with Google." }`

---

### 1.3 Get Current User Profile

- **URL:** `GET /api/auth/me`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
  ```json
  {
    "user": {
      "id": "e4f8b6b1-0987-4321-abcd-123456789abc",
      "email": "user@example.com",
      "displayName": "User Name",
      "avatarUrl": "https://lh3.googleusercontent.com/...",
      "hasPassword": true
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized`: `{ "error": "Unauthorized access. Authentication token required." }`
  - `404 Not Found`: `{ "error": "User profile not found" }`
  - `503 Service Unavailable`: `{ "error": "Database service is temporarily unavailable. Please try again later." }`

---

### 1.4 Get Public Auth Configuration

- **URL:** `GET /api/auth/config`
- **Auth Required:** No
- **Success Response (200 OK):**
  ```json
  {
    "googleClientId": "<google_client_id>.apps.googleusercontent.com"
  }
  ```

---

### 1.5 Google Identity Services Login & Registration

- **URL:** `POST /api/auth/google`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "credential": "<google_id_token_jwt>"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Google authentication successful",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "user": {
      "id": "e4f8b6b1-0987-4321-abcd-123456789abc",
      "email": "user@gmail.com",
      "displayName": "User Name",
      "avatarUrl": "https://lh3.googleusercontent.com/a/...",
      "hasPassword": false
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `{ "error": "Google credential token is required" }`
  - `401 Unauthorized`: `{ "error": "Invalid Google credential: ..." }`
  - `500 Internal Server Error`: `{ "error": "GOOGLE_CLIENT_ID is not configured in the server environment (.env)" }`

---

### 1.6 Change Account Password (Authenticated)

- **URL:** `POST /api/auth/change-password`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "currentPassword": "currentPassword123",
    "newPassword": "newSecurePassword456"
  }
  ```
  *(Note: `currentPassword` is optional for OAuth-only users setting their first password)*
- **Success Response (200 OK):**
  ```json
  {
    "message": "Password updated successfully",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    - `{ "error": "Current password must be a string" }`
    - `{ "error": "New password must be at least 6 characters long" }`
    - `{ "error": "Password cannot exceed 72 characters" }`
    - `{ "error": "Password cannot exceed 72 bytes" }`
    - `{ "error": "Current password is required to set a new password" }`
    - `{ "error": "Current password is incorrect" }`
  - `401 Unauthorized`:
    - `{ "error": "Unauthorized access. Authentication token required." }`
    - `{ "error": "Session expired or invalidated. Please sign in again." }`
    - `{ "error": "Session expired or invalid token. Please sign in again." }`
    - `{ "error": "Unauthorized access. Invalid user identifier." }`
    - `{ "error": "Unauthorized access. User no longer exists." }`
    - `{ "error": "Unauthorized access. User session could not be verified." }`
  - `503 Service Unavailable`:
    - `{ "error": "Database service is temporarily unavailable. Please try again later." }`

---

### 1.7 Request Password Reset Email (Forgot Password)

- **URL:** `POST /api/auth/forgot-password`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "user@example.com"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "If an account exists for this email address, a password reset link has been dispatched. Please check your inbox."
  }
  ```
  *(Generic response prevents email enumeration attacks. If Brevo API is configured, an email with a secure 1-hour expiration link is dispatched. In production, unconfigured email service returns 503 Service Unavailable. In local dev mode without Brevo credentials, the reset link is logged to server console).*
- **Error Responses:**
  - `400 Bad Request`: `{ "error": "Valid email address is required" }`
  - `503 Service Unavailable`: `{ "error": "Email delivery service is currently unavailable. Please try again later." }`

---

### 1.8 Reset Password with Token

- **URL:** `POST /api/auth/reset-password`
- **Auth Required:** No
- **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "token": "b3f5a8947e914d79...",
    "newPassword": "newSecurePassword456"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Password has been reset successfully. You can now sign in with your new password."
  }
  ```
- **Error Responses:**
  - `400 Bad Request`:
    - `{ "error": "Email, reset token, and new password are required" }`
    - `{ "error": "Email, token, and new password must be valid strings" }`
    - `{ "error": "Password must be at least 6 characters long" }`
    - `{ "error": "Password cannot exceed 72 characters" }`
    - `{ "error": "Password cannot exceed 72 bytes" }`
    - `{ "error": "This password reset link is invalid or has already been used. Please request a new one." }`
    - `{ "error": "This password reset link has expired. Password reset links are valid for 1 hour." }`

---

## 2. Schedule Grid Endpoints (`/api/schedule`)

### 2.1 Fetch Weekly Schedule Slots

- **URL:** `GET /api/schedule/week/:weekStart`
- **Auth Required:** Yes (`Bearer <token>`)
- **URL Parameters:** `weekStart` (Monday date string in `YYYY-MM-DD` format, e.g. `2026-08-10`)
- **Success Response (200 OK):**
  ```json
  {
    "weekStart": "2026-08-10",
    "slots": {
      "2026-08-10_13:00": {
        "plannedTask": "Lunch & Rest",
        "actualTask": "Lunch & Rest",
        "category": "Health",
        "status": "Done",
        "planned": 30,
        "actual": 30,
        "notes": "Healthy meal"
      }
    }
  }
  ```

---

### 2.2 Create or Update Schedule Slot

- **URL:** `POST /api/schedule/slot`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "slotKey": "2026-08-10_13:00",
    "plannedTask": "Lunch & Rest",
    "actualTask": "Lunch & Rest",
    "category": "Health",
    "status": "Done",
    "planned": 30,
    "actual": 30,
    "notes": "Meal log"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Slot saved successfully",
    "slotKey": "2026-08-10_13:00"
  }
  ```

---

### 2.3 Clear/Delete Schedule Slot

- **URL:** `DELETE /api/schedule/slot`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "slotKey": "2026-08-10_13:00"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Slot cleared successfully"
  }
  ```

---

## 3. Habit Ledger Endpoints (`/api/habits`)

### 3.1 Fetch Weekly Habit Logs

- **URL:** `GET /api/habits/week/:weekStart`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
  ```json
  {
    "weekStart": "2026-08-10",
    "habits": [
      {
        "id": 1723456789000,
        "name": "Drink Water",
        "pts": 5,
        "time": "01:15 PM",
        "notes": "Hydration log"
      }
    ]
  }
  ```

---

### 3.2 Log Habit Action

- **URL:** `POST /api/habits/log`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "name": "Drink Water",
    "pts": 5,
    "notes": "Hydration log",
    "logTime": "2026-08-10 01:15 PM"
  }
  ```
  *(Note: `logTime` is optional. If provided with a `YYYY-MM-DD` prefix, the date must be within 1800-01-01 and 2200-12-31).*
- **Success Response (200 OK):**
  ```json
  {
    "message": "Habit logged successfully",
    "habit": {
      "id": 1723456789000,
      "name": "Drink Water",
      "pts": 5,
      "time": "2026-08-10 01:15 PM",
      "notes": "Hydration log"
    }
  }
  ```

---

### 3.3 Delete Habit Log

- **URL:** `DELETE /api/habits/:id`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
  ```json
  {
    "message": "Habit log removed"
  }
  ```

---

## 4. Todo & Notes Endpoints (`/api/todos`)

### 4.1 Fetch Weekly Todos & Notes

- **URL:** `GET /api/todos/week/:weekStart`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
  ```json
  {
    "weekStart": "2026-08-10",
    "todos": [
      {
        "id": "c1f7a2b0-1234-5678-90ab-cdef12345678",
        "text": "Review Weekly Goals",
        "completed": true,
        "priority": "High",
        "category": "Work",
        "dueDate": "2026-08-14"
      }
    ],
    "notes": "Weekly focus notes...",
    "noteSheets": [
      { "id": "journal", "title": "Weekly Journal", "icon": "📓", "content": "Weekly focus notes...", "isDefault": true },
      { "id": "tech", "title": "Tech & Architecture", "icon": "💻", "content": "", "isDefault": true },
      { "id": "backlog", "title": "Sprint Backlog", "icon": "💼", "content": "", "isDefault": true },
      { "id": "scratchpad", "title": "Quick Scratchpad", "icon": "⚡", "content": "", "isDefault": true }
    ]
  }
  ```

---

### 4.2 Add Todo Item

- **URL:** `POST /api/todos/todo`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "text": "Review Weekly Goals",
    "priority": "High",
    "category": "Work",
    "dueDate": "2026-08-14"
  }
  ```
  *(Note: `priority`, `category`, and `dueDate` are optional. If provided, `dueDate` must be a valid calendar date between 1800-01-01 and 2200-12-31).*
- **Success Response (200 OK):**
  ```json
  {
    "message": "Todo item added",
    "todo": {
      "id": "c1f7a2b0-1234-5678-90ab-cdef12345678",
      "text": "Review Weekly Goals",
      "completed": false,
      "priority": "High",
      "category": "Work",
      "dueDate": "2026-08-14"
    }
  }
  ```

---

### 4.3 Update Todo Item (Atomic Partial Update)

- **URL:** `PATCH /api/todos/:id`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body (all fields optional for atomic partial updates):**
  ```json
  {
    "text": "Updated task title",
    "priority": "High",
    "category": "Work",
    "completed": true,
    "dueDate": "2026-08-15"
  }
  ```
  *(Note: All fields are optional:*
  - `text`: `string` (must not be empty if provided)
  - `priority`: `string` (`High`, `Medium`, or `Low`)
  - `category`: `string` (e.g. `Work`, `Learning`, `General`)
  - `completed`: `boolean` (toggle completed status)
  - `dueDate`: string `YYYY-MM-DD` (1800–2200) to set/update, or `null` / `""` to clear the due date.
  - If no update fields are provided in the body (e.g. `{}`), the endpoint behaves as a safe no-op existence check, returning `200 OK` if the todo exists for the authenticated user and leaving all fields unchanged. If the todo does not exist or belongs to another user, `404 Not Found` is returned.*)
- **Success Response (200 OK):**
  ```json
  {
    "message": "Todo updated successfully"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Validation errors:
    - `{ "error": "Invalid priority: must be High, Medium, or Low" }`
    - `{ "error": "Task text cannot be empty" }`
    - `{ "error": "Invalid dueDate: must be between 1800-01-01 and 2200-12-31" }`
  - `404 Not Found`: `{ "error": "Todo item not found or unauthorized" }`

---

### 4.4 Delete Todo Item

- **URL:** `DELETE /api/todos/:id`
- **Auth Required:** Yes (`Bearer <token>`)
- **Success Response (200 OK):**
  ```json
  {
    "message": "Todo item deleted"
  }
  ```

---

### 4.5 Save Weekly Scratchpad Notes & Multi-Sheets

- **URL:** `POST /api/todos/notes`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "notes": "Weekly summary notes...",
    "noteSheets": [
      {
        "id": "journal",
        "title": "Weekly Journal",
        "icon": "📓",
        "content": "Weekly summary notes...",
        "isDefault": true
      },
      {
        "id": "custom-1723456789",
        "title": "Project Alpha",
        "icon": "🚀",
        "content": "Phase 1 rollout details...",
        "isDefault": false
      }
    ]
  }
  ```
  *(Note: `notes` and `noteSheets` are optional. The `journal` sheet's content automatically synchronizes with the legacy `weekly_notes` column).*
- **Success Response (200 OK):**
  ```json
  {
    "message": "Notes updated successfully",
    "noteSheets": [
      {
        "id": "journal",
        "title": "Weekly Journal",
        "icon": "📓",
        "content": "Weekly summary notes...",
        "isDefault": true
      },
      {
        "id": "custom-1723456789",
        "title": "Project Alpha",
        "icon": "🚀",
        "content": "Phase 1 rollout details...",
        "isDefault": false
      }
    ]
  }
  ```

---

## 5. System Health Check

### 5.1 Health Check & Database Readiness Status

- **URL:** `GET /api/health`
- **Auth Required:** No
- **Success Response (200 OK):**
  ```json
  {
    "status": "online",
    "database": "connected",
    "service": "DayFlow API Server",
    "version": "2.4.0",
    "timestamp": "2026-09-16T18:50:00.000Z"
  }
  ```
- **Degraded Response (503 Service Unavailable):**
  ```json
  {
    "status": "degraded",
    "database": "disconnected",
    "error": "Database connection unavailable",
    "timestamp": "2026-09-16T18:50:00.000Z"
  }
  ```
