// Mock data for UK Open Banking products (loans and interest rates)
export const mockProducts = [
  {
    "ProductId": "personal-loan-standard",
    "ProductType": "PersonalLoan",
    "MarketingState": "Regular",
    "ProductName": "Personal Loan",
    "ProductDescription": "Unsecured personal loan for various purposes including home improvements, debt consolidation, or major purchases.",
    "ProductURL": "https://www.bank.co.uk/products/personal-loan",
    "TsandCsURL": "https://www.bank.co.uk/terms/personal-loan",
    "SalesDisclosureDoc": "https://www.bank.co.uk/disclosure/personal-loan",
    "InterestRate": {
      "RateType": "Fixed",
      "Rate": "5.9",
      "ApplicationFrequency": "Monthly",
      "CalculationFrequency": "Daily",
      "Notes": ["Representative APR 5.9%", "Rate depends on credit score and loan amount"]
    },
    "LoanInterestRate": {
      "MinRate": "3.9",
      "MaxRate": "29.9",
      "RepresentativeRate": "5.9"
    },
    "Features": [
      "No early repayment fees",
      "Quick online application",
      "Same day decision",
      "Flexible repayment terms"
    ],
    "Eligibility": {
      "MinAge": 18,
      "MaxAge": 75,
      "MinIncome": 15000,
      "MinCreditScore": 650,
      "ResidencyRequired": "UK",
      "Employment": ["Employed", "Self-Employed"]
    },
    "LoanDetails": {
      "MinAmount": 1000,
      "MaxAmount": 50000,
      "MinTerm": 12,
      "MaxTerm": 84,
      "TermUnit": "Months"
    },
    "Fees": [
      {
        "FeeType": "Application",
        "Amount": "0",
        "Currency": "USD"
      },
      {
        "FeeType": "EarlyRepayment",
        "Amount": "0",
        "Currency": "USD"
      }
    ]
  },
  {
    "ProductId": "car-loan-secured",
    "ProductType": "CarLoan",
    "MarketingState": "Regular",
    "ProductName": "Car Loan",
    "ProductDescription": "Secured car loan for new and used vehicles with competitive rates.",
    "ProductURL": "https://www.bank.co.uk/products/car-loan",
    "TsandCsURL": "https://www.bank.co.uk/terms/car-loan",
    "SalesDisclosureDoc": "https://www.bank.co.uk/disclosure/car-loan",
    "InterestRate": {
      "RateType": "Fixed",
      "Rate": "3.9",
      "ApplicationFrequency": "Monthly",
      "CalculationFrequency": "Daily",
      "Notes": ["Representative APR 3.9%", "Secured against vehicle", "Rate depends on vehicle age and value"]
    },
    "LoanInterestRate": {
      "MinRate": "2.9",
      "MaxRate": "9.9",
      "RepresentativeRate": "3.9"
    },
    "Features": [
      "Competitive rates for new and used cars",
      "Up to 7 years repayment term",
      "No early repayment fees",
      "Quick approval process",
      "Flexible deposit options"
    ],
    "Eligibility": {
      "MinAge": 18,
      "MaxAge": 70,
      "MinIncome": 12000,
      "MinCreditScore": 600,
      "ResidencyRequired": "UK",
      "Employment": ["Employed", "Self-Employed"],
      "VehicleAge": {
        "MaxAge": 10,
        "Unit": "Years"
      }
    },
    "LoanDetails": {
      "MinAmount": 5000,
      "MaxAmount": 100000,
      "MinTerm": 12,
      "MaxTerm": 84,
      "TermUnit": "Months"
    },
    "Fees": [
      {
        "FeeType": "Application",
        "Amount": "0",
        "Currency": "USD"
      },
      {
        "FeeType": "EarlyRepayment",
        "Amount": "0",
        "Currency": "USD"
      },
      {
        "FeeType": "Valuation",
        "Amount": "150",
        "Currency": "USD"
      }
    ]
  },
  {
    "ProductId": "mortgage-residential-variable",
    "ProductType": "Mortgage",
    "MarketingState": "Regular",
    "ProductName": "Residential Mortgage",
    "ProductDescription": "Competitive mortgage rates for home purchases and remortgaging.",
    "ProductURL": "https://www.bank.co.uk/products/mortgage",
    "TsandCsURL": "https://www.bank.co.uk/terms/mortgage",
    "SalesDisclosureDoc": "https://www.bank.co.uk/disclosure/mortgage",
    "InterestRate": {
      "RateType": "Variable",
      "Rate": "4.5",
      "ApplicationFrequency": "Monthly",
      "CalculationFrequency": "Daily",
      "Notes": ["Standard Variable Rate", "Tracker and fixed rate options available"]
    },
    "LoanInterestRate": {
      "MinRate": "3.5",
      "MaxRate": "6.5",
      "RepresentativeRate": "4.5"
    },
    "Features": [
      "Fixed rate options available",
      "Tracker rate options",
      "Offset mortgage facility",
      "Overpayment allowance up to 10%",
      "Free valuation"
    ],
    "Eligibility": {
      "MinAge": 18,
      "MaxAge": 65,
      "MinIncome": 20000,
      "MinCreditScore": 700,
      "ResidencyRequired": "UK",
      "Employment": ["Employed", "Self-Employed"],
      "MinDeposit": 10,
      "MaxLTV": 90
    },
    "LoanDetails": {
      "MinAmount": 50000,
      "MaxAmount": 2000000,
      "MinTerm": 60,
      "MaxTerm": 420,
      "TermUnit": "Months"
    },
    "Fees": [
      {
        "FeeType": "Application",
        "Amount": "999",
        "Currency": "USD"
      },
      {
        "FeeType": "Valuation",
        "Amount": "0",
        "Currency": "USD"
      },
      {
        "FeeType": "EarlyRepayment",
        "Amount": "Variable",
        "Currency": "USD",
        "Notes": ["Varies by product and remaining term"]
      }
    ]
  },
  {
    "ProductId": "home-improvement-unsecured",
    "ProductType": "HomeImprovementLoan",
    "MarketingState": "Regular",
    "ProductName": "Home Improvement Loan",
    "ProductDescription": "Unsecured loan specifically for home improvements and renovations.",
    "ProductURL": "https://www.bank.co.uk/products/home-improvement-loan",
    "TsandCsURL": "https://www.bank.co.uk/terms/home-improvement-loan",
    "SalesDisclosureDoc": "https://www.bank.co.uk/disclosure/home-improvement-loan",
    "InterestRate": {
      "RateType": "Fixed",
      "Rate": "4.9",
      "ApplicationFrequency": "Monthly",
      "CalculationFrequency": "Daily",
      "Notes": ["Representative APR 4.9%", "Special rate for home improvements"]
    },
    "LoanInterestRate": {
      "MinRate": "3.5",
      "MaxRate": "15.9",
      "RepresentativeRate": "4.9"
    },
    "Features": [
      "Dedicated home improvement rates",
      "No security required",
      "Quick online application",
      "Funds available within 48 hours",
      "Flexible repayment options"
    ],
    "Eligibility": {
      "MinAge": 18,
      "MaxAge": 75,
      "MinIncome": 18000,
      "MinCreditScore": 650,
      "ResidencyRequired": "UK",
      "Employment": ["Employed", "Self-Employed"],
      "Homeowner": true
    },
    "LoanDetails": {
      "MinAmount": 2500,
      "MaxAmount": 75000,
      "MinTerm": 12,
      "MaxTerm": 120,
      "TermUnit": "Months"
    },
    "Fees": [
      {
        "FeeType": "Application",
        "Amount": "0",
        "Currency": "USD"
      },
      {
        "FeeType": "EarlyRepayment",
        "Amount": "0",
        "Currency": "USD"
      }
    ]
  },
  {
    "ProductId": "business-loan-sme-variable",
    "ProductType": "BusinessLoan",
    "MarketingState": "Regular",
    "ProductName": "Small Business Loan",
    "ProductDescription": "Flexible business loan for small and medium enterprises.",
    "ProductURL": "https://www.bank.co.uk/products/business-loan",
    "TsandCsURL": "https://www.bank.co.uk/terms/business-loan",
    "SalesDisclosureDoc": "https://www.bank.co.uk/disclosure/business-loan",
    "InterestRate": {
      "RateType": "Variable",
      "Rate": "6.5",
      "ApplicationFrequency": "Monthly",
      "CalculationFrequency": "Daily",
      "Notes": ["Variable rate based on Bank of England base rate plus margin"]
    },
    "LoanInterestRate": {
      "MinRate": "4.5",
      "MaxRate": "12.9",
      "RepresentativeRate": "6.5"
    },
    "Features": [
      "Flexible repayment terms",
      "Competitive business rates",
      "Quick decision process",
      "Dedicated business manager",
      "Optional repayment holidays"
    ],
    "Eligibility": {
      "MinAge": 18,
      "MaxAge": 70,
      "MinBusinessAge": 12,
      "MinBusinessAgeUnit": "Months",
      "MinTurnover": 50000,
      "ResidencyRequired": "UK",
      "BusinessType": ["Limited Company", "Partnership", "Sole Trader"]
    },
    "LoanDetails": {
      "MinAmount": 10000,
      "MaxAmount": 500000,
      "MinTerm": 12,
      "MaxTerm": 120,
      "TermUnit": "Months"
    },
    "Fees": [
      {
        "FeeType": "Application",
        "Amount": "500",
        "Currency": "USD"
      },
      {
        "FeeType": "EarlyRepayment",
        "Amount": "Variable",
        "Currency": "USD",
        "Notes": ["2% of outstanding balance if repaid within first year"]
      }
    ]
  }
];
