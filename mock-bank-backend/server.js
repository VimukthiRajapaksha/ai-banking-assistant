const express = require('express');
const cors = require('cors');

// Import mock data from external file
const mockAccounts = require('./data/accounts');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Mock Banking API Server',
    version: '1.0.0',
    endpoints: [
      'GET /accounts - Get all accounts with transactions',
      'GET /accounts/:accountId - Get specific account with transactions',
      'GET /accounts/:accountId/transactions - Get transactions for specific account with filtering'
    ]
  });
});

// Get all accounts with transactions
app.get('/accounts', (req, res) => {
  try {
    res.json({
      success: true,
      data: mockAccounts,
      count: mockAccounts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get specific account by ID
app.get('/accounts/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;
    const account = mockAccounts.find(acc => acc.AccountId === accountId);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: `Account with ID ${accountId} does not exist`
      });
    }
    
    res.json({
      success: true,
      data: account,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get transactions for a specific account
app.get('/accounts/:accountId/transactions', (req, res) => {
  try {
    const { accountId } = req.params;
    const account = mockAccounts.find(acc => acc.AccountId === accountId);
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        message: `Account with ID ${accountId} does not exist`
      });
    }
    
    // Optional query parameters for filtering
    const { limit, offset, category, type, startDate, endDate } = req.query;
    let transactions = [...account.Transactions];
    
    // Filter by category if provided (search in TransactionInformation and MerchantDetails)
    if (category) {
      transactions = transactions.filter(txn => 
        txn.TransactionInformation.toLowerCase().includes(category.toLowerCase()) ||
        (txn.MerchantDetails && txn.MerchantDetails.MerchantName.toLowerCase().includes(category.toLowerCase()))
      );
    }
    
    // Filter by type if provided
    if (type) {
      transactions = transactions.filter(txn => 
        txn.CreditDebitIndicator.toLowerCase() === type.toLowerCase()
      );
    }
    
    // Filter by date range if provided
    if (startDate) {
      transactions = transactions.filter(txn => 
        txn.BookingDateTime.split('T')[0] >= startDate
      );
    }
    if (endDate) {
      transactions = transactions.filter(txn => 
        txn.BookingDateTime.split('T')[0] <= endDate
      );
    }
    
    // Apply pagination
    const totalCount = transactions.length;
    const startIndex = offset ? parseInt(offset) : 0;
    const endIndex = limit ? startIndex + parseInt(limit) : transactions.length;
    const paginatedTransactions = transactions.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: {
        accountId: account.AccountId,
        accountName: account.Nickname,
        transactions: paginatedTransactions,
        pagination: {
          total: totalCount,
          count: paginatedTransactions.length,
          offset: startIndex,
          limit: limit ? parseInt(limit) : null
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.method} ${req.path} does not exist`
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`🚀 Mock Banking API Server running on http://${HOST}:${PORT}`)
});

module.exports = app;
