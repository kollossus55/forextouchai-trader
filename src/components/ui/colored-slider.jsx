import React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const ColoredSlider = React.forwardRef(({ className, rangeClassName, thumbClassName, trackClassName, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className={cn("relative h-2 w-full grow overflow-hidden rounded-full bg-secondary/50", trackClassName)}>
      <SliderPrimitive.Range className={cn("absolute h-full bg-primary", rangeClassName)} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className={cn("block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", thumbClassName)} />
  </SliderPrimitive.Root>
))
ColoredSlider.displayName = SliderPrimitive.Root.displayName

export { ColoredSlider }