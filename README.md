# Videoss Backend

Strong, free, production-ready Node.js + Express backend for the Videoss video downloader.

## Features

- JWT Authentication (Signup / Login / Me)
- Secure password hashing (bcrypt)
- Rate limiting (global + per-endpoint)
- Helmet security headers
- CORS configured
- Clean JSON responses matching the frontend
- File-based user storage (zero external DB cost)
- Ready for free deployment (Render, Railway, Fly.io)

## Quick Start (Local)

```bash
cd videoss-backend
npm install
npm start
```

Server runs at: `http://localhost:5000`

## API Endpoints

### Auth
| Method | Endpoint            | Description              |
|--------|---------------------|--------------------------|
| POST   | /api/auth/signup    | Create account           |
| POST   | /api/auth/login     | Login                    |
| GET    | /api/auth/me        | Get current user (auth)  |

### Video
| Method | Endpoint              | Description                |
|--------|-----------------------|----------------------------|
| POST   | /api/video/fetch      | Get video info + links     |
| GET    | /api/video/platforms  | List supported platforms   |

### Example – Fetch Video

```bash
curl -X POST http://localhost:5000/api/video/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/reel/sample123"}'
```

### Example – Signup

```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"secret123"}'
```

## Deploy Free (Recommended: Render.com)

1. Push this folder to a GitHub repository
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect the repo
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**:
     - `JWT_SECRET` = any long random string
     - `NODE_ENV` = production
     - `FRONTEND_URL` = your frontend URL (or `*`)
5. Deploy → Free tier is enough for personal use

## Notes

- Video data is currently **mocked** so the service stays free, stable, and legal.
- To add real downloading later you can integrate `yt-dlp` (requires careful legal & infrastructure planning).
- Users are stored in `data/users.json` (automatically created).

## License

MIT
