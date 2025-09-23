// Mock data for UK Open Banking accounts
const mockAccounts = [
  {
    "AccountId": "acc-001",
    "Status": "Enabled",
    "StatusUpdateDateTime": "2025-09-20T10:00:00+00:00",
    "Currency": "GBP",
    "AccountType": "Personal",
    "AccountSubType": "CurrentAccount",
    "Nickname": "Primary Current Account",
    "OpeningDate": "2020-01-15",
    "MaturityDate": null,
    "SwitchStatus": "NotSwitched",
    "Account": [
      {
        "SchemeName": "UK.OBIE.SortCodeAccountNumber",
        "Identification": "12345678901234",
        "Name": "Mr John Smith",
        "SecondaryIdentification": "00021"
      }
    ],
    "Servicer": {
      "SchemeName": "UK.OBIE.BICFI",
      "Identification": "NWBKGB2L"
    },
    "Balance": [
      {
        "AccountId": "acc-001",
        "Amount": {
          "Amount": "2850.75",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": "2025-09-23T08:00:00+00:00",
        "CreditLine": [
          {
            "Included": true,
            "Amount": {
              "Amount": "500.00",
              "Currency": "GBP"
            },
            "Type": "Pre-Agreed"
          }
        ]
      },
      {
        "AccountId": "acc-001",
        "Amount": {
          "Amount": "2850.75",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimBooked",
        "DateTime": "2025-09-23T08:00:00+00:00"
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-001",
        "TransactionId": "txn-001",
        "TransactionReference": "CP-001-20250922",
        "Amount": {
          "Amount": "4.75",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-22T14:30:00+00:00",
        "ValueDateTime": "2025-09-22T14:30:00+00:00",
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
            "Currency": "GBP"
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
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-21T09:00:00+00:00",
        "ValueDateTime": "2025-09-21T09:00:00+00:00",
        "TransactionInformation": "Salary Deposit",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "2855.50",
            "Currency": "GBP"
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
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-20T16:45:00+00:00",
        "ValueDateTime": "2025-09-20T16:45:00+00:00",
        "TransactionInformation": "Grocery Store",
        "BankTransactionCode": {
          "Code": "IssuedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "2766.18",
            "Currency": "GBP"
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
    "StatusUpdateDateTime": "2025-09-20T10:00:00+00:00",
    "Currency": "GBP",
    "AccountType": "Personal",
    "AccountSubType": "Savings",
    "Nickname": "High Yield Savings",
    "OpeningDate": "2020-03-01",
    "MaturityDate": null,
    "SwitchStatus": "NotSwitched",
    "Account": [
      {
        "SchemeName": "UK.OBIE.SortCodeAccountNumber",
        "Identification": "12345678905678",
        "Name": "Mr John Smith",
        "SecondaryIdentification": "00022"
      }
    ],
    "Servicer": {
      "SchemeName": "UK.OBIE.BICFI",
      "Identification": "NWBKGB2L"
    },
    "Balance": [
      {
        "AccountId": "acc-002",
        "Amount": {
          "Amount": "15750.25",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": "2025-09-23T08:00:00+00:00"
      },
      {
        "AccountId": "acc-002",
        "Amount": {
          "Amount": "15750.25",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimBooked",
        "DateTime": "2025-09-23T08:00:00+00:00"
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-002",
        "TransactionId": "txn-006",
        "TransactionReference": "INT-006-20250920",
        "Amount": {
          "Amount": "23.45",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-20T23:59:00+00:00",
        "ValueDateTime": "2025-09-20T23:59:00+00:00",
        "TransactionInformation": "Interest Payment",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "Interest"
        },
        "Balance": {
          "Amount": {
            "Amount": "15750.25",
            "Currency": "GBP"
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
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-15T10:30:00+00:00",
        "ValueDateTime": "2025-09-15T10:30:00+00:00",
        "TransactionInformation": "Transfer from Current Account",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "15726.80",
            "Currency": "GBP"
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
    "StatusUpdateDateTime": "2025-09-20T10:00:00+00:00",
    "Currency": "GBP",
    "AccountType": "Personal",
    "AccountSubType": "CreditCard",
    "Nickname": "Platinum Credit Card",
    "OpeningDate": "2021-06-15",
    "MaturityDate": "2026-06-15",
    "SwitchStatus": "NotSwitched",
    "Account": [
      {
        "SchemeName": "UK.OBIE.PAN",
        "Identification": "************9012",
        "Name": "Mr John Smith"
      }
    ],
    "Servicer": {
      "SchemeName": "UK.OBIE.BICFI",
      "Identification": "PCUGB2L"
    },
    "Balance": [
      {
        "AccountId": "acc-003",
        "Amount": {
          "Amount": "1254.70",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Debit",
        "Type": "InterimBooked",
        "DateTime": "2025-09-23T08:00:00+00:00",
        "CreditLine": [
          {
            "Included": true,
            "Amount": {
              "Amount": "8500.00",
              "Currency": "GBP"
            },
            "Type": "Credit"
          }
        ]
      },
      {
        "AccountId": "acc-003",
        "Amount": {
          "Amount": "7245.30",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Type": "InterimAvailable",
        "DateTime": "2025-09-23T08:00:00+00:00"
      }
    ],
    "Transactions": [
      {
        "AccountId": "acc-003",
        "TransactionId": "txn-009",
        "TransactionReference": "SHP-009-20250922",
        "Amount": {
          "Amount": "156.99",
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-22T11:20:00+00:00",
        "ValueDateTime": "2025-09-22T11:20:00+00:00",
        "TransactionInformation": "Online Shopping",
        "BankTransactionCode": {
          "Code": "CustomerCardTransaction",
          "SubCode": "PurchaseTransaction"
        },
        "Balance": {
          "Amount": {
            "Amount": "1254.70",
            "Currency": "GBP"
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
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Debit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-21T19:30:00+00:00",
        "ValueDateTime": "2025-09-21T19:30:00+00:00",
        "TransactionInformation": "Restaurant",
        "BankTransactionCode": {
          "Code": "CustomerCardTransaction",
          "SubCode": "PurchaseTransaction"
        },
        "Balance": {
          "Amount": {
            "Amount": "1097.71",
            "Currency": "GBP"
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
          "Currency": "GBP"
        },
        "CreditDebitIndicator": "Credit",
        "Status": "Booked",
        "BookingDateTime": "2025-09-20T14:00:00+00:00",
        "ValueDateTime": "2025-09-20T14:00:00+00:00",
        "TransactionInformation": "Payment Received",
        "BankTransactionCode": {
          "Code": "ReceivedCreditTransfer",
          "SubCode": "DomesticCreditTransfer"
        },
        "Balance": {
          "Amount": {
            "Amount": "1022.31",
            "Currency": "GBP"
          },
          "CreditDebitIndicator": "Debit",
          "Type": "InterimBooked"
        }
      }
    ]
  }
];

module.exports = mockAccounts;

module.exports = mockAccounts;