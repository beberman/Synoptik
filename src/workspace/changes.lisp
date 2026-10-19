;;;; A log of the documents the index has just read, so a client can wait for
;;;; one instead of asking again and again (REQ-0080 R18, DES-0057 D19).
;;;;
;;;; Written by INDEX-DOCUMENT and RETRACT-DOCUMENT, which every way a document
;;;; reaches the index goes through: the monitor's poll, a write made through
;;;; the service and a rebuild. Read by a long poll, which holds a worker thread
;;;; for as long as it waits, so the wait is bounded and the log is small.

(in-package :synoptik-workspace)

(defparameter *change-log-size* 500
  "How many changes are kept. A client that falls further behind than this is told
to start again rather than handed a log with a hole in it.")

(defparameter *change-wait-limit* 30
  "The longest a caller may be made to wait, in seconds.")

(defvar *change-lock* (bt:make-lock "synoptik-document-changes"))
(defvar *change-wakeup* (bt:make-condition-variable :name "synoptik-document-changes"))

(defvar *change-epoch* (1+ (random 900000000 (make-random-state t)))
  "Fixed for the life of the process. A client holding a sequence number from a
service that has since restarted sees a different epoch and starts again; the
numbers alone could not tell it, because they begin again at one.")

(defvar *change-sequence* 0
  "The number of the newest change, 0 before any.")

(defvar *change-log* '()
  "The newest *CHANGE-LOG-SIZE* changes, newest first: (sequence repository address kind).")

(defun note-document-change (repository-name address kind)
  "Record that the index now holds a new reading of ADDRESS (KIND :CHANGED) or no
longer holds it (:REMOVED), and wake everything waiting."
  (bt:with-lock-held (*change-lock*)
    (push (list (incf *change-sequence*) repository-name address kind) *change-log*)
    (when (> (length *change-log*) *change-log-size*)
      (setf *change-log* (subseq *change-log* 0 *change-log-size*)))
    ;; Every waiter, not one: this bordeaux-threads has no broadcast, and under SBCL its
    ;; condition variable is SBCL's own.
    (sb-thread:condition-broadcast *change-wakeup*)))

(defun document-changes-after (after epoch &key (wait 0))
  "What changed after sequence number AFTER, waiting up to WAIT seconds for
something to. A plist: :EPOCH, :SEQUENCE (the newest number, to ask after next),
:CHANGES (oldest first, each a plist) and :RESET.

:RESET is true when the caller cannot be brought up to date from the log: it
held no number, held one from another epoch, or fell further behind than the log
reaches. It should read everything again and then ask after :SEQUENCE. A caller
with no number gets :RESET and the present :SEQUENCE at once, so it starts from
now and is not handed the history."
  (let ((deadline (+ (get-internal-real-time)
                     (* (min (max wait 0) *change-wait-limit*) internal-time-units-per-second))))
    (bt:with-lock-held (*change-lock*)
      (flet ((answer ()
               (let* ((oldest (if *change-log* (first (car (last *change-log*))) *change-sequence*))
                      (stale (or (null after) (not (eql epoch *change-epoch*))
                                 (> after *change-sequence*)
                                 (and *change-log* (< after (1- oldest))))))
                 (list :epoch *change-epoch*
                       :sequence *change-sequence*
                       :reset stale
                       :changes (if stale
                                    '()
                                    (loop for (sequence repository address kind) in (reverse *change-log*)
                                          when (> sequence after)
                                            collect (list :sequence sequence :repository repository
                                                          :address address
                                                          :kind (string-downcase (string kind)))))))))
        (loop
          (let ((report (answer)))
            (when (or (getf report :reset) (getf report :changes)
                      (>= (get-internal-real-time) deadline))
              (return report))
            (bt:condition-wait *change-wakeup* *change-lock*
                               :timeout (max 0.05 (/ (- deadline (get-internal-real-time))
                                                     internal-time-units-per-second)))))))))
