# Mock Banking API

A Node.js Express server that provides mockdata for testing and development.

## Features

- Mock banking accounts with realistic transaction data
- CORS enabled for frontend integration
- Error handling and validation
- Health check endpoint
- **OpenAPI 3.1 specification** for API documentation
- Docker support for containerized deployment

## Quick Start

### Using Node.js directly

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Or start the production server:
   ```bash
   npm start
   ```

### Using Docker

1. Build the Docker image:
   ```bash
   docker build -t mock-bank-backend .
   ```

2. Run the container:
   ```bash
   docker run -p 3001:3001 mock-bank-backend
   ```

### Using Docker Compose (Recommended)

1. Start the service:
   ```bash
   docker-compose up -d
   ```

2. Stop the service:
   ```bash
   docker-compose down
   ```

3. View logs:
   ```bash
   docker-compose logs -f
   ```

The server will run on `http://localhost:3001`

## API Endpoints

### Get All Accounts
```
GET /accounts
```
Returns all mock banking accounts with their transactions.

### Get Specific Account
```
GET /accounts/:accountId
```
Returns a specific account by ID (e.g., `acc-001`, `acc-002`, `acc-003`).

### Get Account Transactions
```
GET /accounts/:accountId/transactions
```
Returns transactions for a specific account with optional filtering and pagination.

**Query Parameters:**
- `limit` - Number of transactions to return
- `offset` - Number of transactions to skip (for pagination)
- `category` - Filter by transaction description or merchant name (partial match, case-insensitive)
- `type` - Filter by transaction type (`credit` or `debit`)
- `startDate` - Filter transactions from this date (YYYY-MM-DD)
- `endDate` - Filter transactions up to this date (YYYY-MM-DD)

**Examples:**
```bash
# Get all transactions for account acc-001
curl http://localhost:3001/accounts/acc-001/transactions

# Get first 3 transactions
curl "http://localhost:3001/accounts/acc-001/transactions?limit=3"

# Get coffee-related transactions
curl "http://localhost:3001/accounts/acc-001/transactions?category=coffee"

# Get only debit transactions
curl "http://localhost:3001/accounts/acc-001/transactions?type=debit"

# Get transactions with pagination
curl "http://localhost:3001/accounts/acc-001/transactions?limit=2&offset=1"
```

### Health Check
```
GET /health
```
Returns server health status.

### Root Endpoint
```
GET /
```
Returns API information and available endpoints.

## Example Response

```json
{
  "success": true,
  "data": [
    {
      "accountId": "acc-001",
      "accountType": "checking",
      "accountName": "Primary Checking",
      "accountNumber": "****1234",
      "sortCode": "12-34-56",
      "currency": "USD",
      "balance": {
        "available": 2850.75,
        "current": 2850.75,
        "overdraft": 500.00
      },
      "provider": {
        "name": "First National Bank",
        "logo": "https://example.com/fnb-logo.png"
      },
      "transactions": [
        {
          "transactionId": "txn-001",
          "date": "2025-09-22",
          "description": "Coffee Shop Purchase",
          "amount": -4.75,
          "type": "debit",
          "category": "Food & Dining",
          "merchant": "Central Perk Coffee",
          "balance": 2850.75
        }
      ]
    }
  ],
  "count": 3,
  "timestamp": "2025-09-23T10:30:00.000Z"
}
```

## Mock Data

The server includes 3 mock accounts:
- **acc-001**: Personal Current Account (sort code: 123456, account: 78901234)
- **acc-002**: Personal Savings Account (sort code: 123456, account: 78905678)  
- **acc-003**: Personal Credit Card (PAN: ************9012)

Each account contains realistic transaction data with:
- Banking identifiers (sort codes, account numbers, BIC codes)
- Proper Banking transaction codes
- Merchant Category Codes (MCC)
- GBP currency and amounts
- ISO 8601 timestamps with timezones

## Testing

You can test the API using curl:

```bash
# Get all accounts
curl http://localhost:3001/accounts

# Get specific account
curl http://localhost:3001/accounts/acc-001

# Get account transactions
curl http://localhost:3001/accounts/acc-001/transactions

# Get filtered transactions
curl "http://localhost:3001/accounts/acc-001/transactions?category=coffee&limit=3"

# Health check
curl http://localhost:3001/health
```

## Banking Data Structure

The API returns data in the following format:

```json
{
  "success": true,
  "data": [
    {
      "AccountId": "acc-001",
      "Status": "Enabled",
      "Currency": "GBP",
      "AccountType": "Personal",
      "AccountSubType": "CurrentAccount",
      "Nickname": "Primary Current Account",
      "Account": [
        {
          "SchemeName": "UK.OBIE.SortCodeAccountNumber",
          "Identification": "12345678901234",
          "Name": "Mr John Smith"
        }
      ],
      "Balance": [
        {
          "Amount": {
            "Amount": "2850.75",
            "Currency": "GBP"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimAvailable"
        }
      ],
      "Transactions": [
        {
          "TransactionId": "txn-001",
          "Amount": {
            "Amount": "4.75",
            "Currency": "GBP"
          },
          "CreditDebitIndicator": "Debit",
          "Status": "Booked",
          "BookingDateTime": "2025-09-22T14:30:00+00:00",
          "TransactionInformation": "Coffee Shop Purchase",
          "MerchantDetails": {
            "MerchantName": "Central Perk Coffee",
            "MerchantCategoryCode": "5814"
          }
        }
      ]
    }
  ]
}
```

## API Documentation

The complete API specification is available in `openapi.yaml`. You can:

1. **View it online**: Copy the content to [Swagger Editor](https://editor.swagger.io/)
2. **Generate client SDKs**: Use tools like [OpenAPI Generator](https://openapi-generator.tech/)
3. **Import into Postman**: File → Import → select `openapi.yaml`
4. **Use with tools**: Insomnia, Bruno, or any OpenAPI-compatible tool

The OpenAPI spec includes:
- Complete endpoint documentation
- Request/response schemas
- Example values
- Query parameter details
- Error response formats

## Configuration

- **Port**: Default is 3001, can be changed via `PORT` environment variable
- **CORS**: Enabled for all origins (suitable for development)

## Docker Features

The Docker setup includes:
- **Multi-stage build** for optimized image size
- **Non-root user** for security
- **Alpine Linux** base for smaller image size
- **Proper .dockerignore** to exclude unnecessary files

## Development

To modify the mock data, edit the file at `data/accounts.js`. The server will need to be restarted to pick up changes.

For Docker development with auto-reload, you can mount the source code:
```bash
docker run -p 3001:3001 -v $(pwd):/app -v /app/node_modules mock-bank-backend
```