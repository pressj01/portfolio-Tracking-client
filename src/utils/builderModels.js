// Portfolio Builder models from every account. `/api/builder/portfolios`
// lists the selected account's models first, then each other account's;
// `account_name` is the account a model is saved in.
import { formatMoney } from './money.js'

// [{ key, accountName, current, models }] in the order the API listed them.
export function groupModelsByAccount(models) {
  const groups = []
  const byAccount = new Map()
  for (const model of models || []) {
    const key = model.profile_id ?? 'unknown'
    let group = byAccount.get(key)
    if (!group) {
      group = {
        key,
        accountName: model.account_name || 'Unknown account',
        current: Boolean(model.current_account),
        models: [],
      }
      byAccount.set(key, group)
      groups.push(group)
    }
    group.models.push(model)
  }
  return groups
}

export function modelHoldingCount(model) {
  const count = Number(model?.holding_count) || 0
  return `${count} ${count === 1 ? 'holding' : 'holdings'}`
}

export function modelOptionLabel(model) {
  return `${model.name} · ${modelHoldingCount(model)} · ${formatMoney(model.total_value, { digits: 0 })}`
}
