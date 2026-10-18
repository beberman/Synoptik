;;;
;;; Tests for REQ-0080's text reads, writes and creations (DES-0057 D1, D1a).
;;; The fixtures are transition.lisp's: a scratch tree under each store.
;;;

(in-package :synoptik-workspace-test)

(def-suite document-edit
  :in all-tests
  :description "Reading, rewriting and creating one document by its text.")

(in-suite document-edit)

(test an-unedited-save-succeeds-and-leaves-the-bytes-alone
  ;; REQ-0080 R5. A save that sends back what it read must not rewrite the file.
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (saved (write-document-text repository "REQ-0001"
                                         (getf read :text) (getf read :version))))
        (is (null (getf saved :problems)))
        (is (null (getf saved :changed)) "nothing was written")
        (is (string= (requirement-document "REQ-0001")
                     (document-text root "docs/requirements/REQ-0001.yaml")))))))

(test an-edit-with-the-current-version-is-written
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (edited (concatenate 'string (getf read :text) "tags: [web]" (string #\Newline)))
             (saved (write-document-text repository "REQ-0001" edited (getf read :version))))
        (is-true (getf saved :changed))
        (is (string= edited (document-text root "docs/requirements/REQ-0001.yaml")))
        (is (string= (getf saved :version)
                     (getf (read-document-text repository "REQ-0001") :version))
            "the version returned is the version a read now returns")))))

(test a-write-made-from-a-stale-version-is-refused-and-the-first-text-stands
  ;; CON-0003: without the version comparison the second writer's text lands.
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (first-text (concatenate 'string (getf read :text) "tags: [first]" (string #\Newline)))
             (second-text (concatenate 'string (getf read :text) "tags: [second]" (string #\Newline))))
        (write-document-text repository "REQ-0001" first-text (getf read :version))
        (let ((late (write-document-text repository "REQ-0001" second-text (getf read :version))))
          (is-true (getf late :conflict))
          (is (string= first-text (getf late :text)) "the conflict carries the stored text")
          (is (string= first-text (document-text root "docs/requirements/REQ-0001.yaml"))))))))

(test a-document-that-does-not-exist-is-a-problem-and-not-an-error
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (is (getf (read-document-text repository "REQ-0099") :problems))
      (is (getf (write-document-text repository "REQ-0099" "x" "1-0") :problems)))))

(test creating-a-requirement-takes-the-next-id-and-the-file-checks-clean
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0007.yaml" (requirement-document "REQ-0007"))
    (with-indexed-tree (repository root)
      (let ((made (create-document repository "req" "Users share a board: live"
                                   :refines '("REQ-0007"))))
        (is (null (getf made :problems)))
        (is (string= "REQ-0008" (getf made :doc-id)))
        (is-true (document-at-p root "docs/requirements/REQ-0008.yaml"))
        (let ((check (check-document-references repository "docs/requirements/REQ-0008.yaml")))
          (is (null (getf check :error)))
          (is (string= "REQ-0008" (getf check :document))
              "a title with a colon parses back as a title, not a second key")
          (is (eq :resolved (getf (first (getf check :references)) :status))))))))

(test creating-a-bug-writes-a-bug
  (with-document-trees (root)
    (write-document root "docs/bugs/BUG-0003.yaml"
                    (format nil "id: BUG-0003~%type: bug~%title: old~%status: open~%"))
    (with-indexed-tree (repository root)
      (let ((made (create-document repository "bug" "It drops the last row")))
        (is (string= "BUG-0004" (getf made :doc-id)))
        (is (search "type: bug" (document-text root "docs/bugs/BUG-0004.yaml")))
        (is (search "status: open" (document-text root "docs/bugs/BUG-0004.yaml")))))))

(test no-other-category-can-be-created-and-nothing-is-written
  ;; CON-0003: remove the category check and the design is written.
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (dolist (category '("design" "plans" "decisions" "rules"))
        (let ((made (create-document repository category "A design")))
          (is (search "req and bug" (first (getf made :problems))))))
      (is-false (document-at-p root "docs/design/DES-0001.yaml"))
      (is (getf (create-document repository "req" "") :problems) "an empty title"))))

;;; A save and a walk (BUG-0084)

(defun counting-walks (thunk)
  "How many times WALK-TREE ran while THUNK did."
  (let ((walks 0))
    (sb-int:encapsulate 'synoptik-workspace::walk-tree 'count-walks
                        (lambda (function &rest arguments)
                          (incf walks)
                          (apply function arguments)))
    (unwind-protect (funcall thunk)
      (sb-int:unencapsulate 'synoptik-workspace::walk-tree 'count-walks))
    walks))

(test a-save-indexes-the-document-it-wrote-without-walking-the-tree
  ;; BUG-0084: the write polled the store, and a file store polls by walking
  ;; every file under the root. On front-end that was 20 seconds a save.
  (with-document-trees (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (edited (concatenate 'string (getf read :text) "tags: [walkless]" (string #\Newline)))
             (saved nil)
             (walks (counting-walks
                     (lambda ()
                       (setf saved (write-document-text repository "REQ-0001" edited (getf read :version)))))))
        (is-true (getf saved :changed))
        (is (zerop walks) "the save walked the tree ~d time~:p" walks)
        (is (member "walkless" (getp (synoptik-workspace::resolve-document repository "REQ-0001") :tags) :test #'equal)
            "the index holds the text that was written")))))

(test the-poll-after-a-save-finds-nothing-more-to-read
  ;; The token has to take the written file's stamp, or the next poll reads and
  ;; indexes the same text again. A memory store's token is a clock and not a
  ;; table of stamps, so it reads the document once more, harmlessly: file only.
  (with-document-tree (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (edited (concatenate 'string (getf read :text) "tags: [once]" (string #\Newline))))
        (write-document-text repository "REQ-0001" edited (getf read :version))
        (is (zerop (synoptik-workspace::poll-documents repository :quiet t)))))))

(test the-walk-does-not-enter-node-modules-or-a-dot-directory
  ;; BUG-0084. node_modules is skipped by name at any depth (BUG-0085 is what that
  ;; costs), and a dot-directory is skipped because nothing in one is a document.
  (with-document-trees (root)
    (dolist (path '("lib/z.md" "src/a.md" "node_modules/p/README.md"
                    "web/node_modules/q/README.md" ".hidden/b.md" "web/.cache/c.md" "web/ok/d.md"))
      (write-document root path "x"))
    (let ((found (mapcar (lambda (path) (enough-namestring path (pathname root)))
                         (synoptik-workspace::walk-tree root))))
      (is (equal '("lib/z.md" "src/a.md" "web/ok/d.md")
                 (sort (copy-list found) #'string<))))))

;;; Suggestions and the committed text (REQ-0080 R20)

(defun run-git (root &rest arguments)
  (uiop:run-program (append (list "git" "-C" (namestring root)) arguments)
                    :output :string :error-output :string))

(test an-unresolved-reference-is-offered-where-its-name-is-defined-now
  ;; The case that prompted R20: `netArea' moved from one file to another and the
  ;; decision still names the first.
  (with-document-tree (root)
    (write-document root "src/new-place.lisp" (format nil "(defun moved-thing () 1)~%"))
    (write-document root "docs/requirements/REQ-0001.yaml"
                    (format nil "id: REQ-0001~%title: a requirement~%status: draft~%~
affects: [\"function:src/old-place.lisp:moved-thing\", \"function:src/new-place.lisp:moved-thing\", gone-for-good]~%~
refines: [REQ-0099]~%body: |~%  R1  the ask.~%"))
    (with-indexed-tree (repository root)
      (let* ((report (reference-suggestions repository "REQ-0001"))
             (by-name (lambda (name)
                        (find name (getf report :suggestions) :key (lambda (s) (getf s :name))
                                                              :test #'string=))))
        (is (null (getf report :problems)))
        (is (= 2 (length (getf report :suggestions)))
            "the resolved reference and the document reference draw no suggestion")
        (let ((candidates (getf (funcall by-name "function:src/old-place.lisp:moved-thing") :candidates)))
          (is (= 1 (length candidates)))
          (is (search "src/new-place.lisp" (getf (first candidates) :replacement))))
        (is (null (getf (funcall by-name "gone-for-good") :candidates))
            "a name defined nowhere has no candidate, and is reported as that")))))

(test a-draft-is-checked-instead-of-the-saved-text
  (with-document-tree (root)
    (write-document root "src/new-place.lisp" (format nil "(defun moved-thing () 1)~%"))
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (with-indexed-tree (repository root)
      (let ((draft (format nil "id: REQ-0001~%title: a requirement~%status: draft~%~
affects: [\"function:src/old-place.lisp:moved-thing\"]~%body: |~%  R1  the ask.~%")))
        (is (null (getf (reference-suggestions repository "REQ-0001") :suggestions)))
        (is (= 1 (length (getf (reference-suggestions repository "REQ-0001" :text draft)
                               :suggestions))))))))

(test the-committed-text-is-what-git-holds-and-not-the-edited-file
  (with-document-tree (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (run-git root "init" "-q")
    (run-git root "add" "-A")
    (run-git root "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "first")
    (with-indexed-tree (repository root)
      (let* ((read (read-document-text repository "REQ-0001"))
             (edited (concatenate 'string (getf read :text) "tags: [later]" (string #\Newline))))
        (write-document-text repository "REQ-0001" edited (getf read :version))
        (let ((committed (committed-document-text repository "REQ-0001")))
          (is (null (getf committed :problems)))
          (is (string= (requirement-document "REQ-0001") (getf committed :text)))
          (is (string= (getf read :version) (getf committed :version))
              "the version is the one a read of that text gives, so it can be written back"))))))

(test a-document-git-has-never-seen-has-no-committed-text
  (with-document-tree (root)
    (write-document root "docs/requirements/REQ-0001.yaml" (requirement-document "REQ-0001"))
    (run-git root "init" "-q")
    (with-indexed-tree (repository root)
      (is (getf (committed-document-text repository "REQ-0001") :problems)))))
