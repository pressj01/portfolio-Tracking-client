// An Owner rollup is not a standalone account, even if only one underlying
// account holds this particular ticker. Send the update to its members.
export function dripCheckboxPayload(profileId, isAggregate, accountCount, reinvest) {
  return profileId === 1 && !isAggregate && accountCount > 0
    ? { reinvest, reinvest_all_accounts: true }
    : { reinvest }
}
