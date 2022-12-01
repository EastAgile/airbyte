import { faCheck, faExclamation, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import classNames from "classnames";
import React from "react";

import { Text } from "components/ui/Text";

import { Button } from "../Button";
import styles from "./Toast.module.scss";

export enum ToastType {
  WARNING = "warning",
  SUCCESS = "success",
  ERROR = "error",
  INFO = "info",
}

export interface ToastProps {
  text?: string | React.ReactNode;
  type?: ToastType;
  onAction?: () => void;
  actionBtnText?: string;
  onClose?: () => void;
}

const ICON_MAPPING = {
  [ToastType.WARNING]: faExclamation,
  [ToastType.ERROR]: faTimes,
  [ToastType.SUCCESS]: faCheck,
  [ToastType.INFO]: faExclamation,
};

const STYLES_BY_TYPE: Readonly<Record<ToastType, string>> = {
  [ToastType.WARNING]: styles.warning,
  [ToastType.ERROR]: styles.error,
  [ToastType.SUCCESS]: styles.success,
  [ToastType.INFO]: styles.info,
};

export const Toast: React.FC<ToastProps> = ({ type = ToastType.INFO, onAction, actionBtnText, onClose, text }) => {
  return (
    <div className={classNames(styles.toastContainer, STYLES_BY_TYPE[type])}>
      <div className={classNames(styles.iconContainer)}>
        <FontAwesomeIcon icon={ICON_MAPPING[type]} className={styles.toastIcon} />
      </div>
      <div>
        {text && (
          <Text size="lg" className={styles.text}>
            {text}
          </Text>
        )}
      </div>
      {onAction && (
        <Button className={styles.actionButton} onClick={onAction}>
          {actionBtnText}
        </Button>
      )}
      {onClose && (
        <Button
          className={styles.closeButton}
          variant="clear"
          onClick={onClose}
          icon={<FontAwesomeIcon icon={faTimes} />}
        />
      )}
    </div>
  );
};
