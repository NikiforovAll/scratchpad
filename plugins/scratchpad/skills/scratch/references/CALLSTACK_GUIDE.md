# Call stacks

Tag the fence ` ```callstack `. Draw the tree the way you already would.

```callstack
OrderJob.RunAsync
└─ OrderService.SubmitAsync(order)                ← ~restructured
   ├─ PricingService.Quote(order)
   │     └─ null  ───────────► return    (nothing to charge)
   ├─ OrderPolicy.CanSubmit(order, quote)         ← +new gate
   │     ├─ order.IsCancelled            → false
   │     └─ switch (quote.Tier)
   ├─ InventoryClient.ReserveAsync(order)         ← now behind the gate
   └─ OrderFactory.From(order)                    ← -callerless overload
```

## Annotate with `←`

Write the note after `←` at the end of the line. The first character sets its colour.

| Sigil | Means | Colour |
|---|---|---|
| `+` | added | green |
| `-` | removed | red |
| `~` | changed in place | amber |
| *(none)* | plain note | neutral |

Default to no sigil. Use one only when the reader needs to know what kind of change
happened — a trace of existing code takes none.

One `←` note per line, at the end. Earlier `←` on the same line stay literal.

## Layout

- Use `→` for what a line produces, `←` for a note about the line.
- Align the annotation columns yourself. No line is ever reflowed or rewritten.
- Keep lines under ~100 characters. Past that the block scrolls sideways and the
  annotations are what go off-screen.
- On a deep tree align per sibling group, not to one global column.

## When not to use it

Use `mermaid` for the shape of a system. Use a call stack for a path — this called
that, and here is what changed. With no annotations and no ordering, write a list.
