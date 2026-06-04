import type { ReactNode } from "react"
import type { StaleLinkedAccountSelection } from "@app/domain/Manager/AkahuCustomFields"

export function SetupStack(props: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-6">{props.children}</div>
}

export function SetupMessage(props: {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
  readonly action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.24em] text-muted-foreground uppercase">
          {props.eyebrow}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{props.title}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          {props.description}
        </p>
      </div>
      {props.action}
    </div>
  )
}

export function StaleSelections(props: {
  readonly selections: ReadonlyArray<StaleLinkedAccountSelection>
}) {
  if (props.selections.length === 0) return null

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
      aria-label="Stale Akahu selections"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Stale Akahu account selections</h2>
        <p className="text-sm text-muted-foreground">
          These Manager bank/cash accounts point to Akahu accounts that are not currently available.
          Edit each Manager account and choose a current Akahu Account value.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {props.selections.map((selection) => (
          <li key={selection.key} className="rounded-md border bg-background px-3 py-2 text-sm">
            <span className="font-medium">{selection.name || "Unnamed Manager account"}</span>
            <span className="text-muted-foreground">
              {" "}
              uses {selection.selectedAkahuAccountLabel ?? "unknown Akahu account"} (
              {selection.selectedAkahuAccountId})
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
