# ClearPath Finance v4

ClearPath Finance is an original college-project prototype for an all-in-one personal finance dashboard.

## New in v4

### Accounts
- Every asset or investment account now has an editable **Current balance** field.
- Tap **Update** after changing the balance.
- Updating Starter savings also updates the emergency-fund total on the Dashboard.

### Weekly Reports
- Pick any week with the date control, or move backward/forward one week at a time.
- See:
  - weekly income
  - weekly spending
  - savings / goal funding
  - debt-minimum payments or funded minimums
  - spending by category
  - paycheck allocations by category

### Dashboard Payment Calendar
- Monthly calendar added to the bottom of Dashboard.
- Credit cards and loans use the monthly due day stored in the Debts tab.
- Active monthly and yearly Bills & Goals entries feed their due dates into the same calendar.
- Calendar shows the payment name and amount.
- Use Previous, This month, and Next controls to browse months.
- Canceled bills are excluded.

## Existing major features
- Weekly paycheck entry and category allocation
- Editable credit cards, loans, student loans, tuition, and tax debt
- Debt snowball and avalanche simulations
- Lump-sum payoff scenarios
- Monthly and weekly budget percentages
- Budget funded, spent, and remaining views
- Receipt photo capture with item confirmation and category selection
- Transaction rules and tags
- Monthly/yearly bills and subscriptions with edit, delete, cancel, due dates, and payment advancement
- Emergency fund and custom savings goals
- Assets, investments, credit utilization, and manual score snapshot
- Reports and net-worth tracking
- Local browser storage
- JSON backup export/import

## How to run
Open `index.html` in a modern browser.

For the simplest phone or classroom demo, open `ClearPath_Finance_v4_Single_File.html`.

## Prototype limitation
This version does not directly connect to banks, lenders, credit bureaus, or notification services. Those features require secure APIs, authentication, and a backend in a production app.
