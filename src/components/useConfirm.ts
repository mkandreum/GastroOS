import { useState, useCallback } from "react";

export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant?: "danger" | "default";
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (title: string, message: string, variant?: "danger" | "default") =>
      new Promise<boolean>((resolve) => {
        setState({ open: true, title, message, variant, resolve });
      }),
    []
  );

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  return {
    confirm,
    dialogProps: {
      open: state?.open ?? false,
      title: state?.title ?? "",
      message: state?.message ?? "",
      variant: state?.variant,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
