<!--
  QA-owned pinned copy. Source: DayFlow/docs/API_DOCUMENTATION.md at DAYFLOW_PINNED_REF (v2.3.0).
  Everything below the next line is copied verbatim from that file — do not hand-edit it.
  `npm run contract:check` diffs this against the live copy inside the checked-out pinned ref and
  fails loudly on drift (see check-contract-drift.mjs and docs/TECHNICAL_PLAN.md's "Contract
  drift" section). When the dev team ships a contract change, re-copy their file here as part of
  bumping DAYFLOW_PINNED_REF, in the same commit.
-->

# DayFlow REST API Documentation

**Version:** 2.3.0  
**Base URL (Local):** `http://localhost:5000/api`  
**Base URL (Production):** `/api`  
**Authentication Method:** JSON Web Token (`Authorization: Bearer <token>`)

---

## 🔒 Authentication Headers

All protected endpoints require an `Authorization` HTTP header with a valid JWT token obtained from `POST /api/auth/login` or `POST /api/auth/register`:

```http
Authorization: Bearer <your_jwt_token_here>
Content-Type: application/json
```

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
      "displayName": "User Name"
    }
  }
  ```

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
      "displayName": "User Name"
    }
  }
  ```
- **Error Response (401 Unauthorized):**
  ```json
  {
    "error": "Invalid email or password."
  }
  ```

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
      "displayName": "User Name"
    }
  }
  ```

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
    "notes": "Hydration log"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Habit logged successfully",
    "habit": {
      "id": 1723456789000,
      "name": "Drink Water",
      "pts": 5,
      "time": "01:15 PM",
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
        "completed": true
      }
    ],
    "notes": "Weekly focus notes..."
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
    "text": "Review Weekly Goals"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Todo item added",
    "todo": {
      "id": "c1f7a2b0-1234-5678-90ab-cdef12345678",
      "text": "Review Weekly Goals",
      "completed": false
    }
  }
  ```

---

### 4.3 Toggle Todo Completion

- **URL:** `PATCH /api/todos/:id`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "completed": true
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Todo updated successfully"
  }
  ```

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

### 4.5 Save Weekly Scratchpad Notes

- **URL:** `POST /api/todos/notes`
- **Auth Required:** Yes (`Bearer <token>`)
- **Request Body:**
  ```json
  {
    "weekStart": "2026-08-10",
    "notes": "Weekly summary notes..."
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "message": "Notes updated successfully"
  }
  ```

---

## 5. System Health Check

### 5.1 Health Check Status

- **URL:** `GET /api/health`
- **Auth Required:** No
- **Success Response (200 OK):**
  ```json
  {
    "status": "online",
    "service": "DayFlow API Server",
    "timestamp": "2026-08-11T16:25:00.000Z"
  }
  ```
