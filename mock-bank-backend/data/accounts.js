import { getCurrentTime, getDaysAgo } from './utils.js';

// Mock data for banking accounts
export const mockAccounts = [
  {
    "AccountId": "acc-001",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(3),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "CurrentAccount",
    "Nickname": "Primary Current Account",
    "OpeningDate": "2020-01-15",
    "Balance": [
      {
        "AccountId": "acc-001",
        "Amount": {
          "Amount": "2850.75",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": getCurrentTime(),
        "CreditLine": [
          {
            "Included": true,
            "Amount": {
              "Amount": "500.00",
              "Currency": "USD"
            },
            "Type": "Pre-Agreed"
          }
        ]
      },
      {
        "AccountId": "acc-001",
        "Amount": {
          "Amount": "2850.75",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimBooked",
        "DateTime": getCurrentTime()
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-001",
        "TransactionId": "txn-001",
        "TransactionReference": "CP-001-20250922",
        "Amount": {
          "Amount": "4.75",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(1),
        "ValueDateTime": getDaysAgo(1),
        "TransactionInformation": "Coffee Shop Purchase",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "ProprietaryBankTransactionCode": {
          "Code": "Transfer",
          "Issuer": "AlphaBank"
        },
        "Balance": {
          "Amount": {
            "Amount": "2850.75",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimBooked"
        },
        "MerchantDetails": {
          "MerchantName": "Central Perk Coffee",
          "MerchantCategoryCode": "5814"
        }
      },
      {
        "AccountId": "acc-001",
        "TransactionId": "txn-002",
        "TransactionReference": "SAL-002-20250921",
        "Amount": {
          "Amount": "3200.00",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(2),
        "ValueDateTime": getDaysAgo(2),
        "TransactionInformation": "Salary Deposit",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "2855.50",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimBooked"
        },
        "CreditorAccount": {
          "SchemeName": "UK.OBIE.SortCodeAccountNumber",
          "Identification": "98765432109876",
          "Name": "ABC Corporation Payroll"
        }
      },
      {
        "AccountId": "acc-001",
        "TransactionId": "txn-003",
        "TransactionReference": "GRO-003-20250920",
        "Amount": {
          "Amount": "89.32",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(3),
        "ValueDateTime": getDaysAgo(3),
        "TransactionInformation": "Grocery Store",
        "BankTransactionCode": {
          "Code": "IssuedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "2766.18",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimBooked"
        },
        "MerchantDetails": {
          "MerchantName": "Fresh Market",
          "MerchantCategoryCode": "5411"
        }
      }
    ]
  },
  {
    "AccountId": "acc-002",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(2),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "Savings",
    "Nickname": "High Yield Savings",
    "OpeningDate": "2020-03-01",
    "Balance": [
      {
        "AccountId": "acc-002",
        "Amount": {
          "Amount": "15750.25",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": getCurrentTime(),
      },
      {
        "AccountId": "acc-002",
        "Amount": {
          "Amount": "15750.25",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimBooked",
        "DateTime": getCurrentTime(),
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-002",
        "TransactionId": "txn-006",
        "TransactionReference": "INT-006-20250920",
        "Amount": {
          "Amount": "23.45",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(4),
        "ValueDateTime": getDaysAgo(4),
        "TransactionInformation": "Interest Payment",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "Interest"
        },
        "Balance": {
          "Amount": {
            "Amount": "15750.25",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimBooked"
        }
      },
      {
        "AccountId": "acc-002",
        "TransactionId": "txn-007",
        "TransactionReference": "TRF-007-20250915",
        "Amount": {
          "Amount": "500.00",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(2),
        "ValueDateTime": getDaysAgo(2),
        "TransactionInformation": "Transfer from Current Account",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "15726.80",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Credit",
          "Type": "InterimBooked"
        },
        "CreditorAccount": {
          "SchemeName": "UK.OBIE.SortCodeAccountNumber",
          "Identification": "12345678901234",
          "Name": "Mr John Smith Current Account"
        }
      }
    ]
  },
  {
    "AccountId": "acc-003",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(3),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "CreditCard",
    "Nickname": "Platinum Credit Card",
    "OpeningDate": "2021-06-15",
    "MaturityDate": "2026-06-15",
    "Balance": [
      {
        "AccountId": "acc-003",
        "Amount": {
          "Amount": "1254.70",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Type": "InterimBooked",
        "DateTime": getCurrentTime(),
        "CreditLine": [
          {
            "Included": true,
            "Amount": {
              "Amount": "8500.00",
              "Currency": "USD"
            },
            "Type": "Credit"
          }
        ]
      },
      {
        "AccountId": "acc-003",
        "Amount": {
          "Amount": "7245.30",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": getCurrentTime()
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-003",
        "TransactionId": "txn-009",
        "TransactionReference": "SHP-009-20250922",
        "Amount": {
          "Amount": "156.99",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(1),
        "ValueDateTime": getDaysAgo(1),
        "TransactionInformation": "Online Shopping",
        "BankTransactionCode": {
          "Code": "CustomerCardTransaction",
          "SubCode": "PurchaseTransaction"
        },
        "Balance": {
          "Amount": {
            "Amount": "1254.70",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Debit",
          "Type": "InterimBooked"
        },
        "MerchantDetails": {
          "MerchantName": "Amazon UK",
          "MerchantCategoryCode": "5300"
        }
      },
      {
        "AccountId": "acc-003",
        "TransactionId": "txn-010",
        "TransactionReference": "RST-010-20250921",
        "Amount": {
          "Amount": "75.40",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(2),
        "ValueDateTime": getDaysAgo(2),
        "TransactionInformation": "Restaurant",
        "BankTransactionCode": {
          "Code": "CustomerCardTransaction",
          "SubCode": "PurchaseTransaction"
        },
        "Balance": {
          "Amount": {
            "Amount": "1097.71",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Debit",
          "Type": "InterimBooked"
        },
        "MerchantDetails": {
          "MerchantName": "The Fancy Bistro",
          "MerchantCategoryCode": "5812"
        }
      },
      {
        "AccountId": "acc-003",
        "TransactionReference": "PAY-011-20250920",
        "TransactionId": "txn-011",
        "Amount": {
          "Amount": "500.00",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": getDaysAgo(5),
        "ValueDateTime": getDaysAgo(5),
        "TransactionInformation": "Payment Received",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "1022.31",
            "Currency": "USD"
          },
          "CreditDebitIndicator": "Debit",
          "Type": "InterimBooked"
        }
      }
    ]
  }
];
