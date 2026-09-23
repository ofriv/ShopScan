# Shopping Scraper

A real-time product price scraper across multiple e-commerce websites, built with a **Next.js** frontend and a **FastAPI** backend.

## Features

- Search for any product and compare prices across:
  - Amazon.com
  - BestBuy.com
  - Walmart.com
  - Newegg.com
- **4-method fallback pipeline** per site:
  1. Basic scraping (requests + BeautifulSoup)
  2. Browser-based scraping (Playwright)
  3. LLM-based extraction (Google Gemini)
  4. Firecrawl API
- Graceful failure handling — if a site fails, the rest still show results
- Displays: product title, price, average rating, review count, status, and method used

## Project Structure

```
Shopping-Scraper/
├── backend/
│   ├── main.py              # FastAPI app & API routes
│   ├── models.py            # Pydantic data models
│   ├── pipeline.py          # Fallback scraping orchestrator
│   └── scrapers/
│       ├── basic.py         # requests + BeautifulSoup
│       ├── browser.py       # Playwright
│       ├── llm.py           # Google Gemini API
│       └── firecrawl.py     # Firecrawl API
└── frontend/                # Next.js app
```

## Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
playwright install chromium
```

Copy `backend/.env.example` to `backend/.env` and fill in your keys:
```
GEMINI_API_KEY=your_gemini_key_here
FIRECRAWL_API_KEY=your_firecrawl_key_here
OPENAI_API_KEY=your_openai_key_here
```

Run the backend:
```bash
uvicorn main:app
```

> **Windows note:** do **not** use `--reload` — uvicorn's file-watcher forces a
> `SelectorEventLoop` on Windows which prevents Playwright from launching Chrome.
> Without `--reload`, Python uses its default `ProactorEventLoop` and the browser
> scraper works correctly. Just restart the server manually after code changes.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
