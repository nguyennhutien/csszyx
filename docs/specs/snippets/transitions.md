# Transitions & Animation

Controlling transition and animation properties.

## Transition Property

Utilities for controlling which CSS properties transition.

| Concept       | CSS Rule                                                            | Tailwind v4 Class                                                                                        | `sz` Prop (Object Syntax)   | Note                |
| :------------ | :------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------- | :-------------------------- | :------------------ |
| **None**      | `transition-property: none;`                                        | `transition-none`                                                                                        | `{ transition: 'none' }`    |                     |
| **Common**    | `transition-property: color, background-color, border-color, (etc)` | `transition`                                                                                             | `{ transition: true }`      | Default properties. |
| **Scale**     | `transition-property: color, background-color, border-color, (etc)` | `transition-all`, `transition-colors`, `transition-opacity`, `transition-shadow`, `transition-transform` | `{ transition: 'colors' }`  |                     |
| **Arbitrary** | `transition-property: opacity`                                      | `transition-opacity`                                                                                     | `{ transition: 'opacity' }` |                     |

## Transition Behavior

Utilities for controlling the transition behavior.

| Concept      | CSS Rule                               | Tailwind v4 Class     | `sz` Prop (Object Syntax)            | Note |
| :----------- | :------------------------------------- | :-------------------- | :----------------------------------- | :--- |
| **Discrete** | `transition-behavior: allow-discrete;` | `transition-discrete` | `{ transitionBehavior: 'discrete' }` |      |
| **Normal**   | `transition-behavior: normal;`         | `transition-normal`   | `{ transitionBehavior: 'normal' }`   |      |

## Transition Duration

Utilities for controlling the duration of CSS transitions.

| Concept       | CSS Rule                      | Tailwind v4 Class | sz Prop              |
| :------------ | :---------------------------- | :---------------- | :------------------- |
| Duration 0    | `transition-duration: 0ms`    | `duration-0`      | `{ duration: 0 }`    |
| Duration 75   | `transition-duration: 75ms`   | `duration-75`     | `{ duration: 75 }`   |
| Duration 100  | `transition-duration: 100ms`  | `duration-100`    | `{ duration: 100 }`  |
| Duration 150  | `transition-duration: 150ms`  | `duration-150`    | `{ duration: 150 }`  |
| Duration 200  | `transition-duration: 200ms`  | `duration-200`    | `{ duration: 200 }`  |
| Duration 300  | `transition-duration: 300ms`  | `duration-300`    | `{ duration: 300 }`  |
| Duration 500  | `transition-duration: 500ms`  | `duration-500`    | `{ duration: 500 }`  |
| Duration 700  | `transition-duration: 700ms`  | `duration-700`    | `{ duration: 700 }`  |
| Duration 1000 | `transition-duration: 1000ms` | `duration-1000`   | `{ duration: 1000 }` |

## Transition Timing Function

Utilities for controlling the easing of CSS transitions.

| Concept       | CSS Rule                                                | Tailwind v4 Class                                   | `sz` Prop (Object Syntax)               | Note |
| :------------ | :------------------------------------------------------ | :-------------------------------------------------- | :-------------------------------------- | :--- |
| **Keywords**  | `transition-timing-function: linear`                    | `ease-linear`, `ease-in`, `ease-out`, `ease-in-out` | `{ ease: 'in' }`                        |      |
| **Arbitrary** | `transition-timing-function: cubic-bezier(0.4,0,0.2,1)` | `ease-[cubic-bezier(0.4,0,0.2,1)]`                  | `{ ease: 'cubic-bezier(0.4,0,0.2,1)' }` |      |
| **Variable**  | `transition-timing-function: var(--e)`                  | `ease-(--e)`                                        | `{ ease: '--e' }`                       |      |

## Transition Delay

Utilities for controlling the delay of CSS transitions.

| Concept    | CSS Rule                   | Tailwind v4 Class | sz Prop           |
| :--------- | :------------------------- | :---------------- | :---------------- |
| Delay 0    | `transition-delay: 0ms`    | `delay-0`         | `{ delay: 0 }`    |
| Delay 75   | `transition-delay: 75ms`   | `delay-75`        | `{ delay: 75 }`   |
| Delay 100  | `transition-delay: 100ms`  | `delay-100`       | `{ delay: 100 }`  |
| Delay 150  | `transition-delay: 150ms`  | `delay-150`       | `{ delay: 150 }`  |
| Delay 200  | `transition-delay: 200ms`  | `delay-200`       | `{ delay: 200 }`  |
| Delay 300  | `transition-delay: 300ms`  | `delay-300`       | `{ delay: 300 }`  |
| Delay 500  | `transition-delay: 500ms`  | `delay-500`       | `{ delay: 500 }`  |
| Delay 700  | `transition-delay: 700ms`  | `delay-700`       | `{ delay: 700 }`  |
| Delay 1000 | `transition-delay: 1000ms` | `delay-1000`      | `{ delay: 1000 }` |

## Animation

Utilities for animating elements with CSS animations.

| Concept       | CSS Rule                             | Tailwind v4 Class                                                 | `sz` Prop (Object Syntax)                | Note |
| :------------ | :----------------------------------- | :---------------------------------------------------------------- | :--------------------------------------- | :--- |
| **None**      | `animation: none;`                   | `animate-none`                                                    | `{ animate: 'none' }`                    |      |
| **Keywords**  | `animation: spin 1s linear infinite` | `animate-spin`, `animate-ping`, `animate-pulse`, `animate-bounce` | `{ animate: 'spin' }`                    |      |
| **Arbitrary** | `animation: spin_1s_linear_infinite` | `animate-[spin_1s_linear_infinite]`                               | `{ animate: 'spin_1s_linear_infinite' }` |      |
