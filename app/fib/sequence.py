def fibonacci(n: int) -> list[int]:
    seq = [0, 1][:n]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq
