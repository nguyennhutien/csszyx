# Transforms

Utilities for controlling element transformations.

## Rotate

Utilities for rotating elements.

| Concept        | CSS Rule           | Tailwind v4 Class                            | `sz` Prop (Object Syntax) | Note          |
| :------------- | :----------------- | :------------------------------------------- | :------------------------ | :------------ |
| Rotate 0       | `rotate: 0deg`     | `rotate-0`                                   | `{ rotate: 0 }`           |               |
| Rotate 1       | `rotate: 1deg`     | `rotate-1`                                   | `{ rotate: 1 }`           |               |
| Rotate 2       | `rotate: 2deg`     | `rotate-2`                                   | `{ rotate: 2 }`           |               |
| Rotate 3       | `rotate: 3deg`     | `rotate-3`                                   | `{ rotate: 3 }`           |               |
| Rotate 6       | `rotate: 6deg`     | `rotate-6`                                   | `{ rotate: 6 }`           |               |
| Rotate 12      | `rotate: 12deg`    | `rotate-12`                                  | `{ rotate: 12 }`          |               |
| Rotate 45      | `rotate: 45deg`    | `rotate-45`                                  | `{ rotate: 45 }`          |               |
| Rotate 90      | `rotate: 90deg`    | `rotate-90`                                  | `{ rotate: 90 }`          |               |
| Rotate 180     | `rotate: 180deg`   | `rotate-180`                                 | `{ rotate: 180 }`         |               |
| **Neg Angle**  | `rotate: -45deg`   | `-rotate-45`                                 | `{ rotate: -45 }`         |               |
| **X/Y/Z Axis** | `rotate: x 45deg`  | `rotate-x-45`, `rotate-y-90`, `rotate-z-180` | `{ rotateX: 45 }`(etc)    | 3D rotations. |
| **Arbitrary**  | `rotate: 1.2rad`   | `rotate-[1.2rad]`                            | `{ rotate: '1.2rad' }`    |               |
| **Variable**   | `rotate: var(--r)` | `rotate-(--r)`                               | `{ rotate: '--r' }`       |               |

## Scale

Utilities for scaling elements.

| Concept       | CSS Rule          | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------------ | :---------------- | :---------------- | :------------------------ | :--- |
| Scale 0       | `scale: 0`        | `scale-0`         | `{ scale: 0 }`            |      |
| Scale 50      | `scale: 0.5`      | `scale-50`        | `{ scale: 50 }`           |      |
| Scale 75      | `scale: 0.75`     | `scale-75`        | `{ scale: 75 }`           |      |
| Scale 90      | `scale: 0.9`      | `scale-90`        | `{ scale: 90 }`           |      |
| Scale 95      | `scale: 0.95`     | `scale-95`        | `{ scale: 95 }`           |      |
| Scale 100     | `scale: 1`        | `scale-100`       | `{ scale: 100 }`          |      |
| Scale 105     | `scale: 1.05`     | `scale-105`       | `{ scale: 105 }`          |      |
| Scale 110     | `scale: 1.1`      | `scale-110`       | `{ scale: 110 }`          |      |
| Scale 125     | `scale: 1.25`     | `scale-125`       | `{ scale: 125 }`          |      |
| Scale 150     | `scale: 1.5`      | `scale-150`       | `{ scale: 150 }`          |      |
| Scale 200     | `scale: 2`        | `scale-200`       | `{ scale: 200 }`          |      |
| **X Axis**    | `scale-x: 0.5`    | `scale-x-50`      | `{ scaleX: 50 }`          |      |
| **Y Axis**    | `scale-y: 0.5`    | `scale-y-50`      | `{ scaleY: 50 }`          |      |
| **Z Axis**    | `scale-z: 0.5`    | `scale-z-50`      | `{ scaleZ: 50 }`          |      |
| **3D**        | `scale: 0.5`      | `scale-3d`        | `{ scale3d: true }`       |      |
| **Arbitrary** | `scale: 1.5`      | `scale-[1.5]`     | `{ scale: '1.5' }`        |      |
| **Variable**  | `scale: var(--s)` | `scale-(--s)`     | `{ scale: '--s' }`        |      |

## Skew

Utilities for skewing elements.

| Concept       | CSS Rule                  | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------------ | :------------------------ | :---------------- | :------------------------ | :--- |
| Skew X 0      | `transform: skewX(0deg)`  | `skew-x-0`        | `{ skewX: 0 }`            |      |
| Skew X 1      | `transform: skewX(1deg)`  | `skew-x-1`        | `{ skewX: 1 }`            |      |
| Skew X 2      | `transform: skewX(2deg)`  | `skew-x-2`        | `{ skewX: 2 }`            |      |
| Skew X 3      | `transform: skewX(3deg)`  | `skew-x-3`        | `{ skewX: 3 }`            |      |
| Skew X 6      | `transform: skewX(6deg)`  | `skew-x-6`        | `{ skewX: 6 }`            |      |
| Skew X 12     | `transform: skewX(12deg)` | `skew-x-12`       | `{ skewX: 12 }`           |      |
| Skew Y 0      | `transform: skewY(0deg)`  | `skew-y-0`        | `{ skewY: 0 }`            |      |
| Skew Y 1      | `transform: skewY(1deg)`  | `skew-y-1`        | `{ skewY: 1 }`            |      |
| Skew Y 2      | `transform: skewY(2deg)`  | `skew-y-2`        | `{ skewY: 2 }`            |      |
| Skew Y 3      | `transform: skewY(3deg)`  | `skew-y-3`        | `{ skewY: 3 }`            |      |
| Skew Y 6      | `transform: skewY(6deg)`  | `skew-y-6`        | `{ skewY: 6 }`            |      |
| Skew Y 12     | `transform: skewY(12deg)` | `skew-y-12`       | `{ skewY: 12 }`           |      |
| **Arbitrary** | `skew-x: 5deg`            | `skew-x-[5deg]`   | `{ skewX: '5deg' }`       |      |

## Translate

Utilities for translating elements.

| Concept                  | CSS Rule                                       | Tailwind v4 Class                      | `sz` Prop (Object Syntax)       | Note                                                           |
| :----------------------- | :--------------------------------------------- | :------------------------------------- | :------------------------------ | :------------------------------------------------------------- |
| **Translate X Spacing**  | `translate-x: calc(var(--spacing) * <number>)` | `translate-x-<number>`                 | `{ translateX: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Translate X Px**       | `translate-x: 1px`                             | `translate-x-px`                       | `{ translateX: 'px' }`          |                                                                |
| **Translate X Fraction** | `translate-x: calc(<int>/<int> * 100%)`        | `translate-x-<int>/<int>`              | `{ translateX: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Translate Y Spacing**  | `translate-y: calc(var(--spacing) * <number>)` | `translate-y-<number>`                 | `{ translateY: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Translate Y Px**       | `translate-y: 1px`                             | `translate-y-px`                       | `{ translateY: 'px' }`          |                                                                |
| **Translate Y Fraction** | `translate-y: calc(<int>/<int> * 100%)`        | `translate-y-<int>/<int>`              | `{ translateY: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Z Axis**               | `translate-z: 4px`                             | `translate-z-0`(etc)                   | `{ translateZ: 4 }`             |                                                                |
| **Full**                 | `translate: (value)`                           | `translate-x-full`, `translate-y-full` | `{ translateX: 'full' }`        |                                                                |
| **3D**                   | `translate: (value)`                           | `translate-3d`                         | `{ translate3d: true }`         |                                                                |
| **Arbitrary**            | `translate-x: 5px`                             | `translate-x-[5px]`                    | `{ translateX: '5px' }`         |                                                                |
| **Variable**             | `translate-x: var(--t)`                        | `translate-x-(--t)`                    | `{ translateX: '--t' }`         |                                                                |

## Transform Origin

Utilities for controlling the origin of transformations.

| Concept       | CSS Rule                     | Tailwind v4 Class                                                                                                                                                 | `sz` Prop (Object Syntax) | Note                             |
| :------------ | :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------ | :------------------------------- |
| **Keywords**  | `transform-origin: center`   | `origin-center`, `origin-top`, `origin-top-right`, `origin-right`, `origin-bottom-right`, `origin-bottom`, `origin-bottom-left`, `origin-left`, `origin-top-left` | `{ origin: 'top' }`       | Shorthand for `transformOrigin`. |
| **Arbitrary** | `transform-origin: (etc)`    | `origin-[33%_75%]`                                                                                                                                                | `{ origin: '33%_75%' }`   |                                  |
| **Variable**  | `transform-origin: var(--o)` | `origin-(--o)`                                                                                                                                                    | `{ origin: '--o' }`       |                                  |

## Transform Style

Utilities for controlling how children of a 3D element are rendered.

| Concept  | CSS Rule                        | Tailwind v4 Class | `sz` Prop (Object Syntax)    | Note |
| :------- | :------------------------------ | :---------------- | :--------------------------- | :--- |
| **Flat** | `transform-style: flat;`        | `transform-flat`  | `{ transformStyle: 'flat' }` |      |
| **3D**   | `transform-style: preserve-3d;` | `transform-3d`    | `{ transformStyle: '3d' }`   |      |

## Backface Visibility

Utilities for controlling whether the back face of an element is visible when turned towards the user.

| Concept     | CSS Rule                        | Tailwind v4 Class  | `sz` Prop (Object Syntax) | Note                                |
| :---------- | :------------------------------ | :----------------- | :------------------------ | :---------------------------------- |
| **Visible** | `backface-visibility: visible;` | `backface-visible` | `{ backface: 'visible' }` | Shorthand for `backfaceVisibility`. |
| **Hidden**  | `backface-visibility: hidden;`  | `backface-hidden`  | `{ backface: 'hidden' }`  |                                     |

## Perspective

Utilities for controlling the 3D perspective of an element.

| Concept       | CSS Rule                | Tailwind v4 Class                                          | `sz` Prop (Object Syntax)  | Note |
| :------------ | :---------------------- | :--------------------------------------------------------- | :------------------------- | :--- |
| **Scale**     | `perspective: 250px`    | `perspective-none`, `perspective-xs`(etc)`perspective-2xl` | `{ perspective: 'xs' }`    |      |
| **Arbitrary** | `perspective: 500px`    | `perspective-[500px]`                                      | `{ perspective: '500px' }` |      |
| **Variable**  | `perspective: var(--p)` | `perspective-(--p)`                                        | `{ perspective: '--p' }`   |      |

## Perspective Origin

Utilities for controlling the origin of the perspective.

| Concept       | CSS Rule                     | Tailwind v4 Class                                          | `sz` Prop (Object Syntax)          | Note |
| :------------ | :--------------------------- | :--------------------------------------------------------- | :--------------------------------- | :--- |
| **Keywords**  | `perspective-origin: center` | `perspective-origin-center`, `perspective-origin-top`(etc) | `{ perspectiveOrigin: 'top' }`     |      |
| **Arbitrary** | `perspective-origin: (etc)`  | `perspective-origin-[25%_25%]`                             | `{ perspectiveOrigin: '25%_25%' }` |      |

## Transform

Utilities for controlling the transform property itself.

| Concept  | CSS Rule                                     | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------- | :------------------------------------------- | :---------------- | :------------------------ | :--- |
| **None** | `transform: none;`                           | `transform-none`  | `{ transform: 'none' }`   |      |
| **GPU**  | `transform: translateZ(0)` (GPU compositing) | `transform-gpu`   | `{ transform: 'gpu' }`    |      |
| **CPU**  | `transform: none` (disable GPU compositing)  | `transform-cpu`   | `{ transform: 'cpu' }`    |      |
