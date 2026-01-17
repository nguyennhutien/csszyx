


export function VerificationComponent() {
  return (
    <div sz={{
      // 1. Canonical Keys
      bg: 'blue-500',
      p: 4,

      // 2. Shorthand
      m: 4,

      // 3. Sugar Variable Syntax
      borderColor: '--c-primary', // Should be border-(--c-primary)
      border: '--w-thin',         // Should be border-width-(--w-thin)

      // 4. Theme-mapped
      rounded: 'lg',

      // 5. Grouped
      display: 'flex',
      items: 'center',
      justify: 'center',

      color: 'white'
    }}>
      UX Mapping Verification
    </div>
  )
}
