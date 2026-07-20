;; Sibilant 示例：递归斐波那契 + 尾递归求和
(define (fib n)
  (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))

(define (sum-to n acc)
  (if (= n 0) acc (sum-to (- n 1) (+ acc n))))

(print "fib(10) =" (fib 10))
;; 末行表达式的结果会被 CLI 打印
(sum-to 100 0)
