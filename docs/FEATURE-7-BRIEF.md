# Feature 7: Budgets CRUD + Monthly Planning

**Status**: 🌙 Ready for Overnight Agent Teams Execution  
**Estimated Time**: 8-12 hours  
**Complexity**: HIGH  
**Business Value**: CRITICAL  

---

## 🎯 Overview & Objectives

Implement a comprehensive monthly budgeting system that enables households to:
- Set monthly budgets per class (spending category)
- Track budget vs actual spending variance
- Calculate rollover suggestions (unspent budget → next month)
- Generate auto-budget suggestions based on historical spending
- View 12-month budget overview dashboard
- Manage monthly planning with detailed variance reports

This feature completes the core financial management cycle:
**Categories → Classes → Transactions → Budgets**

---

## 📊 Schema (Already Exists in DB)

```sql
-- From: 20260424000001_core_schema.sql
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  month_year text NOT NULL,  -- Format: 'YYYY-MM'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id, class_id, month_year)
);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON budgets TO authenticated;

-- RLS policies: household-level isolation
```

**No migrations needed** - schema already deployed! ✅

---

## 🔌 API Endpoints to Implement

### 1. `GET /api/budgets`
**Purpose**: List budgets for a specific month  
**Query params**: 
- `month_year` (required): 'YYYY-MM' format
**Response**:
```typescript
{
  budgets: Array<{
    id: uuid;
    class_id: uuid;
    class_name: string;
    amount_cents: number;
    month_year: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }>;
}
```

### 2. `POST /api/budgets`
**Purpose**: Create new budget  
**Body**:
```typescript
{
  class_id: uuid;
  amount_cents: number;  // Must be > 0
  month_year: string;    // 'YYYY-MM' format
  notes?: string;
}
```
**Validation**:
- UNIQUE constraint (household_id, class_id, month_year)
- amount_cents > 0
- month_year strict regex: /^\d{4}-\d{2}$/

### 3. `GET /api/budgets/planning/:month_year`
**Purpose**: Get complete monthly planning with variance  
**Response**:
```typescript
{
  month_year: string;
  classes: Array<{
    class_id: uuid;
    class_name: string;
    category_name: string;
    budget_cents: number | null;
    actual_cents: number;
    variance: {
      variance_cents: number;      // budget - actual
      variance_percent: number;    // (variance / budget) * 100
      status: 'under' | 'over' | 'on_track' | 'no_budget';
    };
    rollover_from_previous: number | null;
  }>;
  totals: {
    total_budgeted: number;
    total_actual: number;
    total_variance: number;
  };
}
```

**Business Logic**:
- `actual_cents`: SUM(transactions.amount_cents WHERE kind='spesa' AND booked_at IN month_year)
- Include ALL classes (even without budget)
- `variance_cents`: budget - actual (positive = under budget, negative = over budget)
- `status` rules:
  - 'no_budget': budget_cents is null
  - 'on_track': variance within ±5% of budget
  - 'under': variance > 5%
  - 'over': variance < -5%

### 4. `PUT /api/budgets/:id`
**Purpose**: Update existing budget  
**Body**:
```typescript
{
  amount_cents?: number;  // Must be > 0
  notes?: string;
}
```
**Note**: Cannot change class_id or month_year (immutable after creation)

### 5. `DELETE /api/budgets/:id`
**Purpose**: Hard delete budget  
**Response**: 204 No Content

### 6. `GET /api/budgets/rollover`
**Purpose**: Calculate rollover suggestions  
**Query params**:
- `from_month`: 'YYYY-MM'
- `to_month`: 'YYYY-MM'
**Response**:
```typescript
{
  suggestions: Array<{
    class_id: uuid;
    class_name: string;
    from_month: string;
    to_month: string;
    unspent_cents: number;           // budget - actual (if positive)
    current_budget_cents: number;    // from_month budget
    existing_next_budget: number | null;
    suggested_budget_cents: number;  // existing + unspent OR current + unspent
  }>;
}
```

**Logic**:
- Only suggest for classes with positive variance (unspent > 0)
- If next month has budget: suggest = existing + unspent
- If next month no budget: suggest = current + unspent

---

## 🧮 Domain Logic (src/lib/domain/budgets.ts)

### **1. Variance Calculation**
```typescript
export interface BudgetVariance {
  variance_cents: number;
  variance_percent: number;
  status: 'under' | 'over' | 'on_track' | 'no_budget';
}

export function calculateVariance(
  budgeted_cents: number | null,
  actual_cents: number
): BudgetVariance;
```

**Test cases** (20+):
- No budget (null) → status 'no_budget'
- Zero actual → 100% under
- Exact match → 0% on_track
- 2% under → on_track
- 6% under → under
- 6% over → over
- Negative actual (should not happen for spesa) → handle gracefully

### **2. Rollover Calculation**
```typescript
export interface RolloverSuggestion {
  class_id: string;
  class_name: string;
  from_month: string;
  to_month: string;
  unspent_cents: number;
  current_budget_cents: number;
  existing_next_budget: number | null;
  suggested_budget_cents: number;
}

export function calculateRollover(
  fromBudget: Budget,
  actualSpent: number,
  toBudget: Budget | null
): RolloverSuggestion | null;
```

**Logic**:
- Return null if variance <= 0 (spent all or overspent)
- unspent_cents = fromBudget.amount_cents - actualSpent
- If toBudget exists: suggested = toBudget.amount_cents + unspent_cents
- If toBudget null: suggested = fromBudget.amount_cents + unspent_cents

**Test cases** (15+):
- Overspent → null
- Exact spend → null
- Underspent + existing next budget
- Underspent + no next budget
- Edge: unspent = 1 cent
- Edge: unspent = entire budget (0 spent)

### **3. Month Formatting & Parsing**
```typescript
export function parseMonthYear(monthYear: string): { year: number; month: number };
export function formatMonthYear(year: number, month: number): string;
export function getMonthRange(monthYear: string): { start: Date; end: Date };
export function addMonths(monthYear: string, count: number): string;
```

**Test cases** (10+):
- Valid formats: '2026-05', '2024-12'
- Invalid formats: '26-05', '2026-5', '2026-13', 'May 2026'
- Month boundaries: January (01), December (12)
- addMonths: rollover year (Dec + 1 = Jan next year)

### **4. Budget Aggregation**
```typescript
export interface MonthlyPlanning {
  month_year: string;
  classes: ClassPlanningRow[];
  totals: PlanningTotals;
}

export function aggregateMonthlyPlanning(
  budgets: Budget[],
  classes: Class[],
  transactions: Transaction[]
): MonthlyPlanning;
```

**Logic**:
- Include ALL classes (even without budget)
- Match transactions by class_id + month_year
- Calculate variance for each class
- Sum totals

**Test cases** (20+):
- Empty budgets
- Empty transactions
- Some classes with budget, some without
- Multiple transactions same class
- Transactions different months (should not count)

---

## 🎨 Frontend Pages & Components

### **Page 1: `/budgets` - Overview Dashboard**
**Purpose**: 12-month overview grid  
**Components**:
- `BudgetOverview` - Main page container
- `MonthCard` - Summary card per month
- `MonthSelector` - Navigate between years

**Features**:
- Default: current year (12 months)
- Month cards show:
  - Total budgeted
  - Total actual
  - Variance %
  - Status indicator (✅ under, ⚠️ over, 📝 no budget)
- Click month → navigate to `/budgets/:month_year`

### **Page 2: `/budgets/:month_year` - Monthly Planning**
**Purpose**: Detailed monthly planning with variance  
**Components**:
- `MonthlyPlanning` - Main page container
- `PlanningTable` - Classes + budget + actual + variance
- `PlanningTotals` - Summary footer
- `RolloverPanel` - Rollover suggestions (if previous month exists)
- `QuickActions` - Copy from previous, Apply suggestions

**Features**:
- Table columns:
  1. Class name (with category badge)
  2. Budget (editable inline or null)
  3. Actual (from transactions)
  4. Variance (€ + %)
  5. Status indicator
  6. Actions (Edit, Delete budget)
- Inline edit: click budget cell → input field
- "Add Budget" button for classes without budget
- Totals row: sum of all columns
- Rollover panel: show suggestions from previous month

### **Page 3: `/budgets/:month_year/edit` - Bulk Edit Mode**
**Purpose**: Edit all budgets at once  
**Components**:
- `BudgetEditForm` - Form with all classes
- `BudgetInput` - Input per class
- `CopyFromPreviousButton`
- `ApplySuggestionsButton`

**Features**:
- Form shows all classes
- Each class: input for amount (in €)
- Copy from previous month → prefill all inputs
- Apply suggestions → prefill based on avg last 3 months
- Bulk save

### **Component Library**

```
src/components/budgets/
├── BudgetOverview.tsx         - 12-month grid
├── MonthCard.tsx              - Month summary card
├── MonthSelector.tsx          - Year navigation
├── MonthlyPlanning.tsx        - Main planning page
├── PlanningTable.tsx          - Budget vs actual table
├── PlanningRow.tsx            - Table row per class
├── PlanningTotals.tsx         - Summary footer
├── RolloverPanel.tsx          - Rollover suggestions
├── BudgetEditForm.tsx         - Bulk edit form
├── BudgetInput.tsx            - Euro input with formatting
├── QuickActions.tsx           - Copy/Apply buttons
└── VarianceIndicator.tsx      - Status badge (✅⚠️📝)
```

### **Server Actions** (`src/app/budgets/actions.ts`)
```typescript
export async function createBudget(data: CreateBudgetInput): Promise<Result>;
export async function updateBudget(id: string, data: UpdateBudgetInput): Promise<Result>;
export async function deleteBudget(id: string): Promise<Result>;
export async function copyFromPreviousMonth(monthYear: string): Promise<Result>;
export async function applyRolloverSuggestions(fromMonth: string, toMonth: string): Promise<Result>;
```

---

## 📐 Business Rules & Constraints

### **Validation Rules**
1. ✅ `amount_cents > 0` (budgets cannot be negative or zero)
2. ✅ `month_year` format: strict `/^\d{4}-\d{2}$/` (YYYY-MM)
3. ✅ `month_year` range: 2020-01 to 2099-12 (reasonable bounds)
4. ✅ UNIQUE constraint: (household_id, class_id, month_year)
5. ✅ class_id must exist in classes table (FK constraint)
6. ✅ Cannot change class_id or month_year after creation (immutable)

### **Household Isolation**
- All queries filter by household_id (derived from user session)
- RLS policies enforce household-level isolation
- No cross-household data leakage

### **Variance Status Rules**
```typescript
if (budget_cents === null) return 'no_budget';
const variance_percent = ((budget - actual) / budget) * 100;
if (variance_percent >= -5 && variance_percent <= 5) return 'on_track';
if (variance_percent > 5) return 'under';
if (variance_percent < -5) return 'over';
```

### **Rollover Logic**
- Only suggest for positive variance (unspent > 0)
- Ignore classes with zero or negative variance
- If next month has budget: add unspent to existing
- If next month no budget: create new with current + unspent

### **Auto-Suggestions**
- Based on average of last 3 months actual spending
- Minimum 2 months of data required
- Round to nearest €5 (e.g., 123.45€ → 125€)
- Confidence levels:
  - HIGH: 3+ months, low variance (<20%)
  - MEDIUM: 2 months, moderate variance (20-50%)
  - LOW: <2 months or high variance (>50%)

---

## 🧪 Test Coverage Requirements

### **Domain Tests** (`src/lib/domain/budgets.test.ts`)
**Target**: 80+ tests

**Variance Calculation** (20 tests):
- No budget scenarios
- Zero actual
- Exact match
- Under budget (1%, 2%, 5%, 10%, 50%, 100%)
- Over budget (1%, 5%, 10%, 50%)
- Edge cases: 1 cent, max int

**Rollover Calculation** (15 tests):
- Overspent → null
- Exact spend → null
- Underspent + existing next budget
- Underspent + no next budget
- Edge: 1 cent unspent
- Edge: 100% unspent (0 spent)

**Month Formatting** (10 tests):
- Valid formats
- Invalid formats
- Boundary months (Jan, Dec)
- addMonths with year rollover

**Aggregation** (20 tests):
- Empty budgets
- Empty transactions
- Partial budgets
- Multiple transactions per class
- Cross-month transactions (should not count)

**Suggestions** (15 tests):
- <2 months data
- 2 months data
- 3+ months data
- High variance
- Low variance
- No historical data

### **API Tests** (100+ tests)

**GET /api/budgets** (20 tests):
- Success with budgets
- Empty result
- Invalid month_year format
- Missing month_year param
- Household isolation

**POST /api/budgets** (25 tests):
- Success create
- Duplicate (same class + month)
- Invalid amount (0, negative)
- Invalid month_year
- Non-existent class_id
- Cross-household class_id
- Missing required fields
- Zod .strict() violations

**GET /api/budgets/planning/:month_year** (25 tests):
- Success with budgets
- Success without budgets (shows all classes)
- Variance calculation correct
- Totals calculation correct
- Invalid month_year
- Empty month (no transactions)
- Mixed: some classes with budget, some without

**PUT /api/budgets/:id** (15 tests):
- Success update amount
- Success update notes
- Invalid amount (0, negative)
- Non-existent budget_id
- Cross-household budget_id
- Attempt to change class_id (should fail)
- Attempt to change month_year (should fail)
- Zod .strict() violations

**DELETE /api/budgets/:id** (10 tests):
- Success delete
- Non-existent id
- Cross-household id
- Idempotent delete

**GET /api/budgets/rollover** (10 tests):
- Success with suggestions
- No suggestions (all overspent)
- Partial suggestions
- Invalid from_month/to_month
- Missing query params

### **Integration Tests** (15 tests)
- Full flow: create budget → add transactions → check variance
- Rollover flow: previous month → suggestion → create next budget
- Copy from previous month
- Delete class → cascade delete budgets

---

## 📦 Deliverables Checklist

### **Backend** (backend-dev)
```
□ src/app/api/budgets/route.ts                  - GET, POST
□ src/app/api/budgets/route.test.ts            - 45 tests
□ src/app/api/budgets/[id]/route.ts            - PUT, DELETE
□ src/app/api/budgets/[id]/route.test.ts       - 25 tests
□ src/app/api/budgets/planning/[month_year]/route.ts - GET
□ src/app/api/budgets/planning/[month_year]/route.test.ts - 25 tests
□ src/app/api/budgets/rollover/route.ts        - GET
□ src/app/api/budgets/rollover/route.test.ts   - 10 tests
```

### **Domain** (domain-dev)
```
□ src/lib/domain/budgets.ts                    - Domain logic
□ src/lib/domain/budgets.test.ts               - 80+ tests
□ src/lib/format/euro.ts                       - formatEuro(), parseEuro() (if not exists)
```

### **Frontend** (frontend-dev)
```
□ src/app/budgets/page.tsx                     - Overview dashboard
□ src/app/budgets/[month_year]/page.tsx        - Monthly planning
□ src/app/budgets/[month_year]/edit/page.tsx   - Bulk edit
□ src/app/budgets/actions.ts                   - Server Actions
□ src/components/budgets/BudgetOverview.tsx
□ src/components/budgets/MonthCard.tsx
□ src/components/budgets/MonthSelector.tsx
□ src/components/budgets/MonthlyPlanning.tsx
□ src/components/budgets/PlanningTable.tsx
□ src/components/budgets/PlanningRow.tsx
□ src/components/budgets/PlanningTotals.tsx
□ src/components/budgets/RolloverPanel.tsx
□ src/components/budgets/BudgetEditForm.tsx
□ src/components/budgets/BudgetInput.tsx
□ src/components/budgets/QuickActions.tsx
□ src/components/budgets/VarianceIndicator.tsx
```

### **Tests** (test-engineer)
```
□ Coverage sweep: 100 API + 80 domain + 15 integration = 195+ tests
□ Edge cases validation
□ Household isolation verification
□ Date boundary testing
```

### **Security** (security-reviewer)
```
□ Zod .strict() on all POST/PUT bodies
□ Household isolation verified
□ SQL injection prevention (parameterized queries)
□ Input validation (month_year, amount_cents)
□ FINAL VERDICT: PASS/BLOCK
```

### **Documentation**
```
□ docs/SMOKE-TEST-FEATURE-7.md                 - Smoke test runbook
□ docs/FEATURE-7-BUDGET-LOGIC.md               - Business rules reference
```

---

## 🤖 Agent Teams Execution Plan

### **Team Composition** (5 teammates + 1 reviewer)

**1. domain-dev** (Foreground, ~3-4 hours)
- Implement `src/lib/domain/budgets.ts`
- Write 80+ domain tests
- Variance calculation
- Rollover logic
- Month formatting utilities
- Aggregation functions

**2. backend-dev** (Parallel with frontend, ~4-5 hours)
- Implement 6 API routes
- Write 100+ API tests
- Household isolation
- Zod validation schemas
- Error handling
- Integration with domain logic

**3. frontend-dev** (Parallel with backend, ~4-5 hours)
- Implement 3 pages
- Implement 12 components
- Server Actions
- Form validation
- State management
- Currency formatting

**4. test-engineer** (After domain/backend/frontend, ~1-2 hours)
- Coverage sweep
- Integration tests (15+)
- Edge case validation
- Cross-feature smoke tests
- Fix any test failures from other teammates

**5. security-reviewer** (Final gate, ~1 hour)
- Review all POST/PUT bodies for .strict()
- Verify household isolation
- Check input validation
- SQL injection prevention
- Issue final PASS/BLOCK verdict

### **Parallel Execution Strategy**
```
Hour 0-1:    domain-dev starts (foundation)
Hour 1:      backend-dev + frontend-dev spawn (parallel)
Hour 4-5:    domain-dev completes
Hour 5-6:    backend-dev completes
Hour 5-6:    frontend-dev completes
Hour 6-7:    test-engineer sweep
Hour 7-8:    security-reviewer audit
Hour 8:      READY TO MERGE
```

### **Dry-run BLOCK Checkpoints**

**Before spawning teams**:
1. ✅ Schema exists? (budgets table) → YES, already deployed
2. ✅ Dependencies ready? (classes, transactions) → YES, Features 3-6 merged
3. ✅ Any conflicting migrations? → NO
4. ✅ Business rules clear? → YES, documented above
5. ✅ Scope creep risks? → LOW, well-defined boundaries

**Proceed if ALL checkpoints pass** ✅

---

## 🎯 Success Criteria

**Feature is COMPLETE when**:
1. ✅ All 6 API routes implemented + tested (100+ tests passing)
2. ✅ All domain logic implemented + tested (80+ tests passing)
3. ✅ All 3 pages + 12 components working
4. ✅ Smoke test passes (create budget → track variance → rollover)
5. ✅ Security audit: PASS
6. ✅ Quality gates: lint ✅ typecheck ✅ test ✅ build ✅
7. ✅ Documentation complete
8. ✅ Merged to main via PR

---

## 📈 Estimated Metrics

```
Production Code:       ~6,500-8,000 lines
Tests:                 ~195-220 tests
Files Created:         ~26 files
API Routes:            6 routes
Frontend Pages:        3 pages
Components:            12 components
Complexity:            HIGH
Business Value:        CRITICAL
Parallelization:       EXCELLENT
Overnight Time:        8-12 hours
```

---

## 🚀 Launch Command

```bash
# Set environment
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Create feature branch
git checkout -b feature/7-budgets-crud

# Launch Agent Teams
claude-code --plan "Feature 7: Budgets CRUD + Monthly Planning - Implement complete monthly budgeting system with variance tracking, rollover suggestions, and 12-month overview dashboard. See docs/FEATURE-7-BRIEF.md for full specification."

# Wait for plan approval
# Then: approve plan
# Teams will execute in parallel overnight
```

---

## ✅ Ready for Overnight Execution

**This brief is COMPLETE and AUTONOMOUS.**

Agent Teams can work overnight without CEO intervention. All business rules, validation logic, and technical specifications are documented.

**Good night, and may the agents ship great code! 🌙🤖**
