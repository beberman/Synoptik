;;;; Reading, rewriting and creating one document by its text.
;;;;
;;;; REQ-0080, DES-0057 D1 and D1a. The web UI edits a document as text and
;;;; creates requirements and bugs. Everything here goes through the document
;;;; store (RULE-0011): this system is the store's only client, so these are the
;;;; functions the registry operations call.
;;;;
;;;; A version crosses a process boundary as a string, which a store's own
;;;; version does not (DES-0051 N2: a caller never inspects one). So the version
;;;; handed out is a token of the text read, and a write compares it with the
;;;; token of the text now in the store, and then hands the store the version it
;;;; read a moment earlier under the repository lock. The store still refuses a
;;;; write whose file changed between the two.

(in-package #:synoptik-workspace)

(defparameter *creatable-categories*
  '(("req" . "requirements") ("requirements" . "requirements")
    ("bug" . "bugs") ("bugs" . "bugs"))
  "The category names `create-document' accepts, and the docs/ directory each
files into. Designs, plans, decisions and the rest are drafted by agents and
reviewed by people, so the UI does not create them (REQ-0080 R16).")

(defun text-version-token (text)
  "A string that changes when TEXT does: its length and a 64-bit FNV-1a hash of
its UTF-8 octets. Detects a changed document and is not a security measure."
  (let ((hash #xcbf29ce484222325))
    (loop for octet across (sb-ext:string-to-octets text :external-format :utf-8)
          do (setf hash (logand #xffffffffffffffff
                                (* (logxor hash octet) #x100000001b3))))
    (format nil "~d-~(~16,'0x~)" (length text) hash)))

(defun document-store-ref (repository designator)
  "Three values: the store ref and address of the one document DESIGNATOR names,
the index entity, and a list of problems."
  (multiple-value-bind (entity problems) (resolve-document repository designator)
    (if problems
        (values nil nil nil problems)
        (multiple-value-bind (ref address) (document-store-entry repository entity)
          (if ref
              (values ref address entity nil)
              (values nil nil nil
                      (list (format nil "~a: the index does not record which file it came from."
                                    designator))))))))

(defun resolve-repository-argument (repository)
  "REPOSITORY as a repository, or two values NIL and a problem plist."
  (if (repository-p repository)
      repository
      (or (find-repository repository)
          (values nil (list :problems (list (format nil "No repository named ~a."
                                                    repository)))))))

(defun read-document-text (repository designator)
  "The text of one document and its version token. A plist with :TEXT,
:VERSION, :DOC-ID and :ADDRESS, or :PROBLEMS when the document cannot be read."
  (multiple-value-bind (repository refusal) (resolve-repository-argument repository)
    (when refusal (return-from read-document-text refusal))
    (multiple-value-bind (ref address entity problems) (document-store-ref repository designator)
      (if problems
          (list :problems problems)
          (handler-case
              (let ((text (docstore-read (repository-document-store repository) ref)))
                (list :repository (repository-name repository)
                      :doc-id (or (getp entity :doc-id) designator)
                      :address address
                      :text text
                      :version (text-version-token text)))
            (error (condition)
              (list :problems (list (format nil "~a cannot be read: ~a" address condition)))))))))

(defun write-document-text (repository designator text version)
  "Replace one document's text with TEXT, if its text is still the one VERSION
describes. Returns a plist.

Written: :TEXT, :VERSION (of what is now stored), :CHANGED, :ADDRESS.
Stale: :CONFLICT T with :TEXT and :VERSION of what the store holds now, and
nothing written, so the caller can show both and let a person choose.
Refused: :PROBLEMS.

Writing the text a document already holds is a success that changes nothing,
which is the unedited save of REQ-0080 R5."
  (multiple-value-bind (repository refusal) (resolve-repository-argument repository)
    (when refusal (return-from write-document-text refusal))
    (with-repository-lock (repository)
      (multiple-value-bind (ref address entity problems) (document-store-ref repository designator)
        (declare (ignore entity))
        (when problems (return-from write-document-text (list :problems problems)))
        (let ((store (repository-document-store repository)))
          (multiple-value-bind (current store-version)
              (handler-case (docstore-read store ref)
                (error (condition)
                  (return-from write-document-text
                    (list :problems (list (format nil "~a cannot be read: ~a" address condition))))))
            (cond
              ((not (equal version (text-version-token current)))
               (list :conflict t :address address
                     :text current :version (text-version-token current)))
              ((string= text current)
               (list :address address :changed nil :text current :version version))
              (t
               (handler-case
                   (let ((record (docstore-write store ref text :expected-version store-version)))
                     (poll-documents repository :quiet t)
                     (list :address (docstore-record-address record) :changed t
                           :text text :version (text-version-token text)))
                 (docstore-conflict ()
                   (let ((now (docstore-read store ref)))
                     (list :conflict t :address address
                           :text now :version (text-version-token now))))
                 (error (condition)
                   (list :problems (list (format nil "~a was not written: ~a"
                                                 address condition)))))))))))))

(defun yaml-scalar (string)
  "STRING as a one-line YAML scalar: plain when that reads back unchanged, and a
double-quoted one otherwise."
  (if (and (plusp (length string))
           (alphanumericp (char string 0))
           (every (lambda (c) (or (alphanumericp c) (find c " ,.()/_'-"))) string))
      string
      (with-output-to-string (out)
        (write-char #\" out)
        (loop for c across string
              do (when (find c "\"\\") (write-char #\\ out))
                 (write-char c out))
        (write-char #\" out))))

(defun creation-problems (category title refines)
  "Every reason `create-document' would refuse, or NIL."
  (let ((problems '()))
    (unless (assoc category *creatable-categories* :test #'string-equal)
      (push (format nil "A ~a document cannot be created here. Only req and bug can; ~
the other types are drafted by agents and edited by people." category)
            problems))
    (when (or (zerop (length (string-trim " " title))) (find #\Newline title))
      (push "The title must be one non-empty line." problems))
    (dolist (name refines)
      (unless (and (plusp (length name))
                   (every (lambda (c) (or (alphanumericp c) (find c "@/._-"))) name))
        (push (format nil "~s is not a document name to refine." name) problems)))
    (nreverse problems)))

(defun today-iso ()
  (multiple-value-bind (second minute hour day month year) (get-decoded-time)
    (declare (ignore second minute hour))
    (format nil "~d-~2,'0d-~2,'0d" year month day)))

(defun creation-template (id kind title refines)
  "The text of a new requirement or bug with the fields its type needs."
  (format nil "id: ~a~%~:[~;type: bug~%~]title: ~a~%status: ~:[draft~;open~]~%~
~:[priority: p2~;severity: minor~]~%date: ~a~%refines: [~{~a~^, ~}]~%tags: []~%~
summary: |~%  ~%"
          id (eq kind :bug) (yaml-scalar title) (eq kind :bug)
          (eq kind :bug) (today-iso) refines))

(defun create-document (repository category title &key refines)
  "Create a requirement or a bug titled TITLE, refining the documents REFINES
names. A plist with :DOC-ID, :ADDRESS, :TEXT and :VERSION, or :PROBLEMS.

The id comes from the store, under the repository lock, so two creations in one
tree cannot be handed the same number. Any other category is refused with the
two that are allowed."
  (multiple-value-bind (repository refusal) (resolve-repository-argument repository)
    (when refusal (return-from create-document refusal))
    (let ((problems (creation-problems category title refines)))
      (when problems (return-from create-document (list :problems problems))))
    (let* ((directory (cdr (assoc category *creatable-categories* :test #'string-equal)))
           (kind (if (string= directory "bugs") :bug :req)))
      (with-repository-lock (repository)
        (handler-case
            (let* ((store (repository-document-store repository))
                   (id (docstore-allocate-id store directory))
                   (text (creation-template id kind (string-trim " " title) refines))
                   (record (docstore-create store directory id text)))
              (poll-documents repository :quiet t)
              (list :repository (repository-name repository)
                    :doc-id id
                    :address (docstore-record-address record)
                    :text text
                    :version (text-version-token text)))
          (error (condition)
            (list :problems (list (format nil "The ~a was not created: ~a"
                                          category condition)))))))))
