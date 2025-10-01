// Mock user profile data for banking customer
const mockUser = {
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
    primaryPhone: "+1-555-0123",
    secondaryPhone: "+1-555-0456",
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
    nextPayDate: "2025-10-15"
  },
  financialProfile: {
    creditScore: 750,
    creditScoreDate: "2025-09-15",
    riskCategory: "Low",
    totalAssets: 250000,
    totalLiabilities: 180000,
    netWorth: 70000,
    monthlyExpenses: 4500
  },
  bankingRelationship: {
    customerSince: "2020-01-15",
    customerSegment: "Premium",
    relationshipManager: "Sarah Johnson",
    branchPreference: "Downtown Branch",
    lastLoginDate: "2025-10-01T10:30:00Z",
    accountsCount: 3,
    activeProductsCount: 5
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

module.exports = mockUser;