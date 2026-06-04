import { AkahuTokens, type AkahuCredentialFieldName } from "@app/domain/Manager/AkahuCustomFields"
import { Option, Schema } from "effect"

export const managerAkahuAppTokenFieldName = "Akahu App Token" satisfies AkahuCredentialFieldName
export const managerAkahuUserTokenFieldName = "Akahu User Token" satisfies AkahuCredentialFieldName

type ManagerAkahuCredentialKey = "akahuAppToken" | "akahuUserToken"

const managerAkahuCredentialFields = [
  { key: "akahuAppToken", fieldName: managerAkahuAppTokenFieldName },
  { key: "akahuUserToken", fieldName: managerAkahuUserTokenFieldName },
] as const satisfies ReadonlyArray<{
  readonly key: ManagerAkahuCredentialKey
  readonly fieldName: AkahuCredentialFieldName
}>

export type ManagerAkahuCredentialFields = {
  readonly akahuAppToken?: ManagerAkahuCredentialTextField | undefined
  readonly akahuUserToken?: ManagerAkahuCredentialTextField | undefined
}

export interface ManagerAkahuCredentialTextField {
  readonly key: string
  readonly item: {
    readonly name?: string | null | undefined
  }
}

export type ManagerAkahuCredentialDecodeResult =
  | {
      readonly _tag: "tokens"
      readonly tokens: AkahuTokens
    }
  | {
      readonly _tag: "missing"
      readonly missingFieldNames: ReadonlyArray<AkahuCredentialFieldName>
    }

export const findManagerAkahuCredentialFields = (
  fields: ReadonlyArray<ManagerAkahuCredentialTextField>,
) => {
  const akahuAppToken = fields.find((field) => field.item.name === managerAkahuAppTokenFieldName)
  const akahuUserToken = fields.find((field) => field.item.name === managerAkahuUserTokenFieldName)
  const credentialFields: ManagerAkahuCredentialFields = {
    akahuAppToken,
    akahuUserToken,
  }

  return {
    ...credentialFields,
    missingFieldNames: getMissingManagerAkahuCredentialFieldNames(credentialFields),
  } as const
}

export const getMissingManagerAkahuCredentialFieldNames = (
  fields: ManagerAkahuCredentialFields,
): ReadonlyArray<AkahuCredentialFieldName> => {
  const missingFieldNames: Array<AkahuCredentialFieldName> = []
  for (const credentialField of managerAkahuCredentialFields) {
    if (fields[credentialField.key] === undefined) {
      missingFieldNames.push(credentialField.fieldName)
    }
  }
  return missingFieldNames
}

export const decodeManagerAkahuBusinessDetailTokens = (input: {
  readonly fields: ManagerAkahuCredentialFields
  readonly strings: Record<string, unknown>
}): ManagerAkahuCredentialDecodeResult => {
  const missingFieldNames: Array<AkahuCredentialFieldName> = []
  const akahuAppToken = getCredentialValueForField(input, "akahuAppToken")
  const akahuUserToken = getCredentialValueForField(input, "akahuUserToken")

  for (const credentialField of managerAkahuCredentialFields) {
    const value = credentialField.key === "akahuAppToken" ? akahuAppToken : akahuUserToken
    if (value === undefined) {
      missingFieldNames.push(credentialField.fieldName)
    }
  }

  if (akahuAppToken === undefined || akahuUserToken === undefined) {
    return { _tag: "missing", missingFieldNames }
  }

  const tokens = Schema.decodeOption(AkahuTokens)({
    akahuAppToken,
    akahuUserToken,
  })
  if (Option.isNone(tokens)) {
    return { _tag: "missing", missingFieldNames: [] }
  }

  return { _tag: "tokens", tokens: tokens.value }
}

const getCredentialValueForField = (
  input: {
    readonly fields: ManagerAkahuCredentialFields
    readonly strings: Record<string, unknown>
  },
  key: ManagerAkahuCredentialKey,
): string | undefined => {
  const field = input.fields[key]
  return field === undefined ? undefined : getManagerAkahuCredentialValue(input.strings[field.key])
}

const getManagerAkahuCredentialValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}
