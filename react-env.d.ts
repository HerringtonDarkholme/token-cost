import "react"

/* `webkitdirectory` is how a file input is asked for a whole folder. It is not in the HTML
   standard and so not in React's attribute types, but it is the only thing that makes
   "Choose folder" work in every browser -- and picking a project folder is the primary way
   transcripts get into this page. Declared here rather than cast at the call site, so the
   attribute stays spelled correctly. */
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string
    directory?: string
  }
}
