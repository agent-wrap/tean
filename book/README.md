# How to build a Lean proof checker if you already are familiar with TypeScript

If you can write a discriminated union and a `switch` over its `kind`,
you can build the one part of a proof assistant that has to be right:
the kernel, a small pure function that takes a proof and answers yes or
no. Over fifteen chapters you build one, a node or a rule at a time,
each chapter ending in code you can paste and run, until it checks what
Lean itself exports. Start with [Chapter 1](ch01.md).
