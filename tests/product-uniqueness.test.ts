import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'

const prisma = new PrismaClient()

describe('Product Uniqueness Constraint', () => {
  let testCompanyId: string
  let testUnitId: string

  beforeAll(async () => {
    // Setup test data
    const trader = await prisma.trader.upsert({
      where: { id: 'test-trader' },
      update: { name: 'Test Trader' },
      create: { id: 'test-trader', name: 'Test Trader' }
    })

    const company = await prisma.company.upsert({
      where: { id: 'test-company' },
      update: { traderId: trader.id, name: 'Test Company' },
      create: {
        id: 'test-company',
        traderId: trader.id,
        name: 'Test Company'
      }
    })

    testCompanyId = company.id

    const unit = await prisma.unit.upsert({
      where: {
        companyId_symbol: {
          companyId: company.id,
          symbol: 'TEST'
        }
      },
      update: { name: 'Test Unit' },
      create: {
        companyId: company.id,
        name: 'Test Unit',
        symbol: 'TEST'
      }
    })

    testUnitId = unit.id
  })

  afterAll(async () => {
    // Cleanup test data
    await prisma.product.deleteMany({
      where: { companyId: testCompanyId }
    })
    await prisma.unit.deleteMany({
      where: { companyId: testCompanyId }
    })
    await prisma.company.delete({
      where: { id: testCompanyId }
    })
    await prisma.trader.delete({
      where: { id: 'test-trader' }
    })
    await prisma.$disconnect()
  })

  it('should create a new product successfully', async () => {
    const product = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: testCompanyId,
          name: 'Test Product 1'
        }
      },
      update: {
        unitId: testUnitId,
        description: 'Updated description'
      },
      create: {
        companyId: testCompanyId,
        name: 'Test Product 1',
        unitId: testUnitId,
        description: 'Initial description'
      }
    })

    expect(product).toBeDefined()
    expect(product.name).toBe('Test Product 1')
    expect(product.companyId).toBe(testCompanyId)
  })

  it('should update existing product instead of throwing unique constraint error', async () => {
    // First creation
    const product1 = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: testCompanyId,
          name: 'Test Product 2'
        }
      },
      update: {
        unitId: testUnitId,
        description: 'First version'
      },
      create: {
        companyId: testCompanyId,
        name: 'Test Product 2',
        unitId: testUnitId,
        description: 'First version'
      }
    })

    expect(product1.description).toBe('First version')

    // Second upsert with same companyId/name combination
    const product2 = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: testCompanyId,
          name: 'Test Product 2'
        }
      },
      update: {
        unitId: testUnitId,
        description: 'Updated version'
      },
      create: {
        companyId: testCompanyId,
        name: 'Test Product 2',
        unitId: testUnitId,
        description: 'Should not be created'
      }
    })

    expect(product2).toBeDefined()
    expect(product2.description).toBe('Updated version')
    expect(product2.id).toBe(product1.id) // Should be same record
  })

  it('should allow same product name for different companies', async () => {
    // Create another company
    const trader2 = await prisma.trader.upsert({
      where: { id: 'test-trader-2' },
      update: { name: 'Test Trader 2' },
      create: { id: 'test-trader-2', name: 'Test Trader 2' }
    })

    const company2 = await prisma.company.upsert({
      where: { id: 'test-company-2' },
      update: { traderId: trader2.id, name: 'Test Company 2' },
      create: {
        id: 'test-company-2',
        traderId: trader2.id,
        name: 'Test Company 2'
      }
    })

    const unit2 = await prisma.unit.upsert({
      where: {
        companyId_symbol: {
          companyId: company2.id,
          symbol: 'TEST2'
        }
      },
      update: { name: 'Test Unit 2' },
      create: {
        companyId: company2.id,
        name: 'Test Unit 2',
        symbol: 'TEST2'
      }
    })

    // Create product with same name but different company
    const product = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: company2.id,
          name: 'Test Product 1' // Same name as first product
        }
      },
      update: {
        unitId: unit2.id,
        description: 'Different company'
      },
      create: {
        companyId: company2.id,
        name: 'Test Product 1',
        unitId: unit2.id,
        description: 'Different company'
      }
    })

    expect(product).toBeDefined()
    expect(product.name).toBe('Test Product 1')
    expect(product.companyId).toBe(company2.id)

    // Cleanup
    await prisma.unit.delete({ id: unit2.id })
    await prisma.company.delete({ id: company2.id })
    await prisma.trader.delete({ id: 'test-trader-2' })
  })

  it('should handle bulk product upserts without errors', async () => {
    const products = [
      { name: 'Bulk Product A', description: 'Product A' },
      { name: 'Bulk Product B', description: 'Product B' },
      { name: 'Bulk Product C', description: 'Product C' }
    ]

    // First pass - create
    for (const productData of products) {
      await prisma.product.upsert({
        where: {
          companyId_name: {
            companyId: testCompanyId,
            name: productData.name
          }
        },
        update: {
          unitId: testUnitId,
          description: productData.description
        },
        create: {
          companyId: testCompanyId,
          name: productData.name,
          unitId: testUnitId,
          description: productData.description
        }
      })
    }

    // Second pass - update (simulating re-seeding)
    for (const productData of products) {
      await prisma.product.upsert({
        where: {
          companyId_name: {
            companyId: testCompanyId,
            name: productData.name
          }
        },
        update: {
          unitId: testUnitId,
          description: `${productData.description} - Updated`
        },
        create: {
          companyId: testCompanyId,
          name: productData.name,
          unitId: testUnitId,
          description: 'Should not create'
        }
      })
    }

    // Verify all products were updated
    const savedProducts = await prisma.product.findMany({
      where: {
        companyId: testCompanyId,
        name: { in: products.map(p => p.name) }
      }
    })

    expect(savedProducts).toHaveLength(products.length)
    savedProducts.forEach(product => {
      expect(product.description).toContain('Updated')
    })
  })
})
