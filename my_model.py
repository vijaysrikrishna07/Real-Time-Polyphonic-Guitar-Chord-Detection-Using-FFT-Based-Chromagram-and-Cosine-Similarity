import torch.nn as nn


class MyModel(nn.Module):

    def __init__(self):
        super(MyModel, self).__init__()
        self.conv1 = nn.Conv2d(16, 1, kernel_size=1)

    def forward(self, x):
        out = self.conv1(x[0])

        return out
