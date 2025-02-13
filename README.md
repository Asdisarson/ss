# Node.js API with SQLite

A simple REST API built with Node.js and SQLite database.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory and add:
```
PORT=3000
```

3. Start the server:
- For production:
```bash
npm start
```
- For development (with auto-reload):
```bash
npm run dev
```

## API Endpoints

### Users

#### GET /api/users
- Returns all users
- Response: Array of user objects

#### POST /api/users
- Creates a new user
- Request body:
```json
{
    "name": "John Doe",
    "email": "john@example.com"
}
```
- Response: Created user object

## Database

The application uses SQLite as the database, stored in `database.sqlite` file. The database will be automatically created when you first run the application. 