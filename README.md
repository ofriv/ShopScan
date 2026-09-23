# ShopScan

A real-time product price comparison tool. Type a product and ShopScan scrapes Amazon, Best Buy, Walmart, and Newegg in parallel, then shows which retailer has the best price. Built with a **Next.js** frontend and a **FastAPI** backend.

## Features

- **Four retailers searched in parallel:** Amazon, Best Buy, Walmart, and Newegg.
- **4-method fallback pipeline per site.** If one method fails or gets blocked, the next one takes over:
  1. Basic scraping (requests + BeautifulSoup)
  2. Browser automation (Playwright), with CAPTCHA and geo-block detection and a pooled browser
  3. LLM extraction (Google Gemini) from the page text
  4. Firecrawl API with structured extraction
- **Smart queries:** GPT-4o-mini validates the search and rewrites it into an optimized query for each retailer.
- **Price sanity check:** an LLM flags prices that look wrong for the product.
- **Live progress:** results stream to the browser over Server-Sent Events as each site finishes.
- **Comparison UI:** best-price badge, price difference between retailers, ranking, and sort tabs.
- **Suggestions:** recommends a complementary product, and clicking it runs a second search below the first.
- **Graceful failure:** if a site fails, the other results still show, along with which method worked for each site.

## Project Structure

```
ShopScan/
├── backend/
│   ├── main.py              # FastAPI app & API routes
│   ├── models.py            # Pydantic data models
│   ├── pipeline.py          # Fallback scraping orchestrator
│   ├── query_processor.py   # OpenAI query optimization, price check, suggestions
│   └── scrapers/
│       ├── basic.py         # requests + BeautifulSoup
│       ├── browser.py       # Playwright
│       ├── llm.py           # Google Gemini API
│       └── firecrawl.py     # Firecrawl API
└── frontend/                # Next.js app
```

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Python, FastAPI, Playwright, BeautifulSoup
- **AI and APIs:** OpenAI GPT-4o-mini, Google Gemini, Firecrawl

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
