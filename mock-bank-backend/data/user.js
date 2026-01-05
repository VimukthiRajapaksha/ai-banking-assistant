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

import { getCurrentTime, getLastDayOfCurrentMonth } from './utils.js';

// Mock user profile data for banking customer
export const mockUser = {
  personalInfo: {
    customerId: "CUST_12345678",
    title: "Mr",
    firstName: "Kevin",
    middleName: "James",
    lastName: "William",
    preferredName: "Kevin",
    dateOfBirth: "1985-03-15",
    nationality: "US",
    maritalStatus: "Married",
    dependents: 2
  },
  contactInfo: {
    primaryEmail: "kevin.william@email.com",
    secondaryEmail: "k.william.work@company.com",
    primaryPhone: "+1 505 648 4707",
    secondaryPhone: "+1 555 123 0456",
    preferredContactMethod: "email",
    communicationLanguage: "en-US"
  },
  addresses: {
    residential: {
      street: "123 Main Street",
      apartment: "Apt 4B",
      city: "New York",
      state: "NY",
      postalCode: "10001",
      country: "US",
      residencyStatus: "Owner",
      yearsAtAddress: 3
    },
    mailing: {
      sameAsResidential: true
    }
  },
  employment: {
    status: "Employed",
    employer: "Tech Corp Inc",
    jobTitle: "Senior Software Engineer",
    industry: "Technology",
    employmentType: "Full-time",
    yearsWithEmployer: 5,
    annualIncome: 120000,
    incomeFrequency: "Annual",
    nextPayDate: getLastDayOfCurrentMonth()
  },
  summary: {
    liquidFunds: 18601.00,
    totalInvestments: 85000.00,
    totalLiabilities: 93254.70,
    netPosition: 10346.30,
    breakdown: {
      assets: {
        currentAccount: 2850.75,
        savingsAccount: 15750.25,
        fixedDeposits: 25000.00,
        stockPortfolio: 35000.00,
        mutualFunds: 15000.00,
        bonds: 10000.00
      },
      liabilities: {
        creditCardBalance: 1254.70,
        personalLoan: 0.00,
        carLoan: 12000.00,
        mortgage: 80000.00
      }
    },
    lastCalculated: getCurrentTime()
  },
  financialProfile: {
    creditScore: 750,
    creditScoreDate: getCurrentTime(),
    riskCategory: "Low",
    totalAssets: 103601,
    totalLiabilities: 93255,
    netWorth: 10346,
    monthlyExpenses: 4500
  },
  bankingRelationship: {
    customerSince: "2020-01-15",
    customerSegment: "Premium",
    relationshipManager: "Sarah Johnson",
    branchPreference: "Downtown Branch",
    lastLoginDate: "2025-10-01T10:30:00Z",
    accountsCount: 5,
    activeProductsCount: 7
  },
  preferences: {
    statementDelivery: "Electronic",
    marketingConsent: true,
    paperlessConsent: true,
    overdraftProtection: true,
    twoFactorAuth: true,
    notificationPreferences: {
      transactionAlerts: true,
      balanceAlerts: true,
      securityAlerts: true,
      promotionalOffers: false
    }
  },
  verification: {
    identityVerified: true,
    emailVerified: true,
    phoneVerified: true,
    addressVerified: true,
    kycStatus: "Completed",
    kycDate: "2020-01-20",
    amlStatus: "Clear",
    lastReviewDate: "2025-01-15"
  },
  compliance: {
    fatcaStatus: "US Person",
    cifStatus: "Active",
    politicallyExposed: false,
    sanctionsScreening: "Clear",
    riskRating: "Low"
  },
  metadata: {
    lastUpdated: "2025-09-28T14:22:00Z",
    dataVersion: "v2.1",
    accessLevel: "Full"
  }
};
