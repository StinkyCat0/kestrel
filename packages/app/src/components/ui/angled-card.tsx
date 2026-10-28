import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

function AngledCard({ className, ...props }: ComponentProps<"div">) {
    return (
        <div
        data-slot="angled-card"
        className={cn(
            "relative flex flex-col gap-4 border bg-card/40 py-5 text-card-foreground shadow-sm backdrop-blur-xl",
            "border-white/10 hover:border-white/20 transition-all duration-300",
            // 45-degree chamfered bottom-right corner
            "[clip-path:polygon(0_0,100%_0,100%_calc(100%_-_16px),calc(100%_-_16px)_100%,0_100%)]",
                      className
        )}
        {...props}
        />
    )
}

function AngledCardHeader({ className, ...props }: ComponentProps<"div">) {
    return <div data-slot="angled-card-header" className={cn("flex flex-col gap-1.5 px-6", className)} {...props} />
}

function AngledCardTitle({ className, ...props }: ComponentProps<"div">) {
    return <div data-slot="angled-card-title" className={cn("font-semibold leading-none tracking-tight text-lg text-white", className)} {...props} />
}

function AngledCardDescription({ className, ...props }: ComponentProps<"div">) {
    return <div data-slot="angled-card-description" className={cn("text-muted-foreground text-sm", className)} {...props} />
}

function AngledCardContent({ className, ...props }: ComponentProps<"div">) {
    return <div data-slot="angled-card-content" className={cn("px-6", className)} {...props} />
}

export { AngledCard, AngledCardContent, AngledCardDescription, AngledCardHeader, AngledCardTitle }
