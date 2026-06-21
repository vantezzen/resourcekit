import { toast } from "sonner";

/** Fire a write and surface rejections as a toast. */
export function notify(promise: Promise<unknown>) {
  void promise.catch((error: Error) => toast.error(error.message));
}
