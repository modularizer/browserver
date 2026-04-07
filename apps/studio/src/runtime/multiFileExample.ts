/**
 * Example: Using Multi-File Support in Browserver Studio
 * 
 * This demonstrates how to organize server code across multiple files
 * in the Browserver Studio IDE using the new multi-file support.
 */

// ============================================================================
// EXAMPLE 1: Single File (Original - Still Works)
// ============================================================================

const singleFileExample = `
import { serveClientSideServer } from '@modularizer/plat-client/client-server'

class MathApi {
  async add({ a, b }: { a: number; b: number }) {
    return a + b
  }
  
  async multiply({ a, b }: { a: number; b: number }) {
    return a * b
  }
}

export default serveClientSideServer('math-api', [MathApi])
`

// ============================================================================
// EXAMPLE 2: Multi-File Organization with Entry Point
// ============================================================================

const multiFileExample = {
  'index.ts': `
import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { MathApi } from './controllers/math'
import { StringApi } from './controllers/string'

export default serveClientSideServer('multi-api', [MathApi, StringApi])
  `,

  'controllers/math.ts': `
import type { MathOperations } from '../types'

/** Math API Controller */
export class MathApi {
  /** Add two numbers together */
  async add({ a, b }: MathOperations) {
    console.log('Computing', a, '+', b)
    return a + b
  }

  /** Multiply two numbers */
  async multiply({ a, b }: MathOperations) {
    console.log('Computing', a, '*', b)
    return a * b
  }

  /** Divide two numbers */
  async divide({ a, b }: MathOperations) {
    if (b === 0) throw new Error('Division by zero')
    return a / b
  }
}
  `,

  'controllers/string.ts': `
import type { StringOperations } from '../types'

/** String API Controller */
export class StringApi {
  /** Convert string to uppercase */
  async toUpper({ text }: StringOperations) {
    return text.toUpperCase()
  }

  /** Convert string to lowercase */
  async toLower({ text }: StringOperations) {
    return text.toLowerCase()
  }

  /** Reverse a string */
  async reverse({ text }: StringOperations) {
    return text.split('').reverse().join('')
  }

  /** Get string length */
  async length({ text }: StringOperations) {
    return text.length
  }
}
  `,

  'types.ts': `
/** Input type for math operations */
export interface MathOperations {
  a: number
  b: number
}

/** Input type for string operations */
export interface StringOperations {
  text: string
}

/** API response wrapper */
export interface ApiResponse<T> {
  data: T
  timestamp: number
  success: boolean
}
  `,
}

// ============================================================================
// EXAMPLE 3: Complex Multi-File with Services
// ============================================================================

const complexMultiFileExample = {
  'index.ts': `
import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { UserController } from './controllers/user'
import { ProductController } from './controllers/product'

export default serveClientSideServer('ecommerce-api', [
  UserController,
  ProductController,
])
  `,

  'controllers/user.ts': `
import type { User, CreateUserRequest } from '../types'
import { userService } from '../services/user'

export class UserController {
  /** Get a user by ID */
  async getUser({ id }: { id: number }): Promise<User | null> {
    return userService.findById(id)
  }

  /** Create a new user */
  async createUser(input: CreateUserRequest): Promise<User> {
    return userService.create(input)
  }

  /** List all users */
  async listUsers(): Promise<User[]> {
    return userService.list()
  }
}
  `,

  'controllers/product.ts': `
import type { Product } from '../types'
import { productService } from '../services/product'

export class ProductController {
  /** Get a product by ID */
  async getProduct({ id }: { id: number }): Promise<Product | null> {
    return productService.findById(id)
  }

  /** List products by category */
  async listByCategory({ category }: { category: string }): Promise<Product[]> {
    return productService.findByCategory(category)
  }

  /** Get total inventory */
  async getTotalInventory(): Promise<number> {
    return productService.getTotalInventory()
  }
}
  `,

  'services/user.ts': `
import type { User, CreateUserRequest } from '../types'

class UserService {
  private users: Map<number, User> = new Map()
  private nextId = 1

  create(input: CreateUserRequest): User {
    const user: User = {
      id: this.nextId++,
      name: input.name,
      email: input.email,
      createdAt: new Date(),
    }
    this.users.set(user.id, user)
    return user
  }

  findById(id: number): User | null {
    return this.users.get(id) ?? null
  }

  list(): User[] {
    return Array.from(this.users.values())
  }
}

export const userService = new UserService()
  `,

  'services/product.ts': `
import type { Product } from '../types'

class ProductService {
  private products: Map<number, Product> = new Map()
  private nextId = 1

  constructor() {
    // Initialize with sample products
    this.products.set(1, {
      id: 1,
      name: 'Laptop',
      category: 'electronics',
      price: 999,
      stock: 10,
    })
    this.nextId = 2
  }

  findById(id: number): Product | null {
    return this.products.get(id) ?? null
  }

  findByCategory(category: string): Product[] {
    return Array.from(this.products.values()).filter(
      (p) => p.category.toLowerCase() === category.toLowerCase(),
    )
  }

  getTotalInventory(): number {
    return Array.from(this.products.values()).reduce(
      (sum, p) => sum + p.stock,
      0,
    )
  }
}

export const productService = new ProductService()
  `,

  'types.ts': `
export interface User {
  id: number
  name: string
  email: string
  createdAt: Date
}

export interface CreateUserRequest {
  name: string
  email: string
}

export interface Product {
  id: number
  name: string
  category: string
  price: number
  stock: number
}
  `,
}

// ============================================================================
// How to Use in Browserver Studio
// ============================================================================

/*
1. SINGLE FILE (Original Approach):
   - Open a file named "server.ts" or "server.js"
   - Paste the code into the editor
   - Click "Start Server" or "Run"
   - The runtime will load and start the server

2. MULTI-FILE ORGANIZATION:
   - Create multiple files in the workspace (e.g., via file tabs)
   - Organize as:
     - index.ts (entry point - MUST export with serveClientSideServer)
     - controllers/math.ts
     - controllers/string.ts
     - types.ts
   - The system will:
     a) Transpile each file independently
     b) Bundle them together with proper module wrapping
     c) Analyze types across all files
     d) Extract controller definitions from all files
   - Result: Clean, organized code while maintaining full functionality

3. Key Requirements:
   - MUST have an entry point file (index.ts) that exports serveClientSideServer()
   - Can import types and classes from other files
   - All files are transpiled with ES2022 target
   - No circular dependencies recommended
   - Import statements between files will be properly handled during bundling

4. Benefits:
   - Better code organization for complex servers
   - Type definitions can be shared across files
   - Business logic can be separated into services
   - Controllers can focus on API routes
   - Easier to maintain and test
*/

// ============================================================================
// Migration Path from Single to Multi-File
// ============================================================================

/*
Single File Original:
┌─────────────────────────────────────────┐
│ server.ts                               │
│ ├─ class MathApi { ... }               │
│ ├─ class StringApi { ... }             │
│ ├─ interface MathOperations { ... }    │
│ ├─ interface StringOperations { ... }  │
│ └─ export default serveClientSideServer(...) │
└─────────────────────────────────────────┘

Multi-File Organized:
┌─────────────────────────────────────────┐
│ index.ts                                │
│ └─ export default serveClientSideServer(...) │
├─────────────────────────────────────────┤
│ controllers/                            │
│ ├─ math.ts (class MathApi)             │
│ └─ string.ts (class StringApi)         │
├─────────────────────────────────────────┤
│ services/                               │
│ ├─ math-service.ts                     │
│ └─ string-service.ts                   │
├─────────────────────────────────────────┤
│ types.ts                                │
│ ├─ interface MathOperations            │
│ └─ interface StringOperations          │
└─────────────────────────────────────────┘
*/

export { singleFileExample, multiFileExample, complexMultiFileExample }

