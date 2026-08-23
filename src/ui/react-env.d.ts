import "react"

/* `webkitdirectory` is how a file input is asked for a whole folder. */
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}
