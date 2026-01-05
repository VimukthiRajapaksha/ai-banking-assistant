/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { getCurrentTime, getDaysAgo, getDaysFromNow } from './utils.js';

// Mock data for banking accounts
export const mockAccounts = [
  {
    "AccountId": "20142041827563",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(3),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "CurrentAccount",
    "Nickname": "Primary Current Account",
    "OpeningDate": "2020-01-15",
    "Balance": [
      {
        "AccountId": "20142041827563",
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
        "AccountId": "20142041827563",
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
        "AccountId": "20142041827563",
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
        "AccountId": "20142041827563",
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
        "AccountId": "20142041827563",
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
    "AccountId": "04000469873452",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(2),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "Savings",
    "Nickname": "High Yield Savings",
    "OpeningDate": "2020-03-01",
    "Balance": [
      {
        "AccountId": "04000469873452",
        "Amount": {
          "Amount": "15750.25",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": getCurrentTime(),
      },
      {
        "AccountId": "04000469873452",
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
        "AccountId": "04000469873452",
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
        "AccountId": "04000469873452",
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
    "AccountId": "23000312549876",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(3),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "CreditCard",
    "Nickname": "Platinum Credit Card",
    "OpeningDate": "2021-06-15",
    "MaturityDate": "2026-06-15",
    "PaymentDueDate": getDaysFromNow(13),
    "MinimumPaymentAmount": {
      "Amount": "50.00",
      "Currency": "USD"
    },
    "Balance": [
      {
        "AccountId": "23000312549876",
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
        "AccountId": "23000312549876",
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
        "AccountId": "23000312549876",
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
        "AccountId": "23000312549876",
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
        "AccountId": "23000312549876",
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
  },
  {
    "AccountId": "60161387654321",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(5),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "Mortgage",
    "Nickname": "Home Mortgage",
    "OpeningDate": "2022-05-15",
    "MaturityDate": "2052-05-15",
    "PaymentDueDate": getDaysFromNow(28),
    "MonthlyPaymentAmount": {
      "Amount": "1200.00",
      "Currency": "USD"
    },
    "Balance": [
      {
        "AccountId": "60161387654321",
        "Amount": {
          "Amount": "80000.00",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Type": "InterimBooked",
        "DateTime": getCurrentTime(),
        "InterestRate": {
          "Rate": "4.25",
          "Type": "Fixed"
        }
      }
    ],
    "LoanDetails": {
      "OriginalAmount": "320000.00",
      "RemainingTerm": "15 years",
      "InterestRate": "4.25%",
      "LoanType": "Fixed Rate Mortgage"
    }
  },
  {
    "AccountId": "30907054231098",
    "Status": "Enabled",
    "StatusUpdateDateTime": getDaysAgo(2),
    "Currency": "USD",
    "AccountType": "Personal",
    "AccountSubType": "CarLoan",
    "Nickname": "Tesla Model 3 Loan",
    "OpeningDate": "2023-08-20",
    "MaturityDate": "2028-08-20",
    "PaymentDueDate": getDaysFromNow(18),
    "MonthlyPaymentAmount": {
      "Amount": "285.00",
      "Currency": "USD"
    },
    "Balance": [
      {
        "AccountId": "30907054231098",
        "Amount": {
          "Amount": "12000.00",
          "Currency": "USD"
        },
        "CreditDebitIndicator": "Debit",
        "Type": "InterimBooked",
        "DateTime": getCurrentTime(),
        "InterestRate": {
          "Rate": "3.99",
          "Type": "Fixed"
        }
      }
    ],
    "LoanDetails": {
      "OriginalAmount": "35000.00",
      "RemainingTerm": "2 years 5 months",
      "InterestRate": "3.99%",
      "LoanType": "Auto Loan",
      "Collateral": "2023 Tesla Model 3"
    }
  }
];
