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
