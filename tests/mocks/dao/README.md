# DAO Test Refactoring Guide

This directory contains centralized mocks and utilities to eliminate duplication across DAO test files.

## Problem Identified

The current DAO test files have significant duplication:
- Every test file mocks `@models/index` with identical patterns
- Every test file mocks `@dao/baseDAO` with the same class structure  
- Every test file mocks `@utils/index`, `@shared/customErrors`, etc.
- Same mongoose query chain mocking patterns repeated everywhere

## Solution

### 1. Centralized Mocks (`commonMocks.ts`)
- `setupDAOTestMocks()` - Sets up all common mocks in one call
- Individual mock functions for selective use
- Consistent mongoose query chain patterns
- Shared error handling mocks

### 2. Test Setup Utilities (`daoTestSetup.ts`)
- `setupDAOTest()` - Standard DAO test initialization
- `DAOTestHelpers` - Common assertion and helper functions
- `DAOTestPatterns` - Reusable test patterns for CRUD operations

### 3. Example Refactored Test (`userDAO.refactored.test.ts`)
Shows how to use the centralized utilities to eliminate duplication.

## How to Refactor Existing Tests

### Before (Current Pattern):
```typescript
// 70+ lines of repeated mocks in every file
jest.mock('@models/index', () => ({
  User: {
    create: jest.fn(),
    findOne: jest.fn(),
    // ... 20+ more methods
  },
}));

jest.mock('@dao/baseDAO', () => ({
  BaseDAO: class MockBaseDAO {
    // ... 15+ methods
  },
}));

// ... more duplicate mocks

describe('UserDAO - Unit Tests', () => {
  let userDAO: UserDAO;
  let mockUserModel: any;
  
  beforeAll(() => {
    // Manual setup...
  });
  // ... tests
});
```

### After (Refactored Pattern):
```typescript
import { setupDAOTest, DAOTestHelpers } from '@tests/mocks/dao/daoTestSetup';

describe('UserDAO - Unit Tests', () => {
  const daoSetup = setupDAOTest(UserDAO, 'User');
  let userDAO: UserDAO;
  let mockUserModel: any;

  beforeAll(() => {
    const setup = daoSetup.setup();
    userDAO = setup.dao;
    mockUserModel = setup.mockModel;
  });

  beforeEach(() => {
    daoSetup.beforeEachSetup();
  });
  
  // ... tests with less boilerplate
});
```

## Refactoring Steps for Each DAO Test File

1. **Replace all jest.mock() calls** with:
   ```typescript
   import { setupDAOTest } from '@tests/mocks/dao/daoTestSetup';
   ```

2. **Replace manual DAO setup** with:
   ```typescript
   const daoSetup = setupDAOTest(DAOClass, 'ModelName');
   ```

3. **Use standardized beforeAll/beforeEach**:
   ```typescript
   beforeAll(() => {
     const setup = daoSetup.setup();
     dao = setup.dao;
     mockModel = setup.mockModel;
   });

   beforeEach(() => {
     daoSetup.beforeEachSetup();
   });
   ```

4. **Use DAOTestHelpers** for common patterns:
   ```typescript
   await DAOTestHelpers.expectDatabaseError(
     () => dao.someMethod(params),
     'Expected error message'
   );
   ```

## Files That Need Refactoring

1. `/tests/unit/dao/clientDAO.test.ts`
2. `/tests/unit/dao/profileDAO.test.ts` 
3. `/tests/unit/dao/propertyUnitDAO.test.ts`
4. `/tests/unit/dao/baseDAO.test.ts`
5. `/tests/unit/dao/userDAO.test.ts` (partially done)

## Benefits of Refactoring

- **Reduces code duplication** by ~70% per test file
- **Consistent mock behavior** across all tests
- **Easier maintenance** - change mocks in one place
- **Better test reliability** - standardized setup reduces flaky tests
- **Faster test writing** - less boilerplate for new DAO tests

## Migration Priority

1. Start with `userDAO.test.ts` (example provided)
2. Refactor `clientDAO.test.ts` and `profileDAO.test.ts`
3. Handle `propertyUnitDAO.test.ts` (largest file)
4. Update `baseDAO.test.ts` 
5. Update any new DAO tests to use this pattern

## Usage Examples

See `userDAO.refactored.test.ts` for a complete working example of how the refactored tests should look.