import { groupModelsByAccount, modelOptionLabel } from '../utils/builderModels'

// A Portfolio Builder model picker. Models from several accounts are grouped
// under the account each one is saved in; any of them can be chosen.
export default function BuilderModelSelect({ models, value, onChange, ...props }) {
  const groups = groupModelsByAccount(models)
  const option = model => <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
  return (
    <select value={value ?? ''} onChange={e => onChange(Number(e.target.value))} {...props}>
      {groups.length <= 1
        ? groups[0]?.models.map(option)
        : groups.map(group => (
          <optgroup key={group.key} label={group.accountName}>
            {group.models.map(option)}
          </optgroup>
        ))}
    </select>
  )
}
